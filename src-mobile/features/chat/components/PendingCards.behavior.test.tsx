// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessions } from "../../../core/stores/sessions";
import type * as CoreApi from "../../../core/api";
import type { MobileSession, PendingEntry } from "../../../core/types";
import { ChatCtx } from "../ChatContext";
import { ChatController } from "../chatStore";
import type { AskQuestion } from "../lib/askDriver";
import { PendingCards } from "./PendingCards";

const apiMock = vi.fn();
vi.mock("../../../core/api", async (orig) => {
	const real = await orig<typeof CoreApi>();
	return { ...real, api: (...args: unknown[]) => apiMock(...args), upload: vi.fn() };
});

const session: MobileSession = {
	id: "pending-test", label: "测试", title: "测试", status: "awaiting_answer", pending: "answer",
	updatedAt: "2026-10-27T00:00:00Z", cwd: "/project", live: true,
};
const wrap = (controller: ChatController, node: ReactNode) => (
	<ChatCtx.Provider value={{ controller, openActions: () => {}, openStat: () => {} }}>{node}</ChatCtx.Provider>
);
const question = (id: string, text: string, multi = false): AskQuestion => ({
	id, question: text, multi, options: [{ label: "甲" }, { label: "乙" }],
});
const pending = (id: string, q: AskQuestion, index: number, total: number, selected = 0, editor = false): PendingEntry => ({
	request: {
		id, method: editor ? "editor" : "select",
		title: `${selected ? `(${selected} selected) ` : ""}${q.question}${total > 1 ? ` (${index + 1}/${total})` : ""}`,
		...(editor ? {} : { options: [...q.options.map((o) => o.label), "Other (type your own)", ...(q.multi ? ["✓ Done selecting"] : [])] }),
	},
});

/** Model the real endpoint: POST consumes an id, GET exposes the next request. */
function transport(steps: PendingEntry[], options: { failPost?: string; consumeFailedPost?: boolean; failGetAfter?: string } = {}) {
	let index = 0;
	let postFailed = false;
	let fetchFailures = 0;
	apiMock.mockImplementation(async (method: string, path: string, body?: { response?: { id: string } }) => {
		if (method === "POST" && path.endsWith("/ui-respond")) {
			const id = body?.response?.id;
			if (id !== steps[index]?.request?.id) throw new Error(`Consumed request replayed: ${id}`);
			if (id === options.failPost && !postFailed) {
				postFailed = true;
				if (options.consumeFailedPost) index++;
				throw new Error("submit unavailable");
			}
			index++;
			return {};
		}
		if (method === "GET" && path.endsWith("/pending-ui")) {
			if (options.failGetAfter && steps[index - 1]?.request?.id === options.failGetAfter && fetchFailures++ < 20) throw new Error("fetch unavailable");
			return steps[index] ? [steps[index]] : [];
		}
		if (path === "/sessions") return [{ ...session, pending: steps[index] ? "answer" : null }];
		return {};
	});
}

function mountAsk(toolCallId: string, questions: AskQuestion[], entry: PendingEntry) {
	const c = new ChatController(session.id);
	c.store.setState({
		pendings: [entry],
		live: {
			id: "live", role: "assistant", kind: "assistant", text: "", thinking: "", images: [], ts: null, streaming: true,
			tools: [{ id: toolCallId, name: "ask", args: { questions }, status: "running", result: "" }],
		},
	});
	render(wrap(c, <PendingCards />));
	return c;
}
const click = async (name: string) => {
	await act(async () => fireEvent.click(screen.getByRole("button", { name })));
};
const choose = async (label: string, multi = false) => {
	await act(async () => fireEvent.click(screen.getByRole(multi ? "checkbox" : "radio", { name: label })));
};
const flushReplies = async (milliseconds = 4000) => {
	await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
};
const responses = () => apiMock.mock.calls.filter(([method, path]) => method === "POST" && String(path).endsWith("/ui-respond")).map(([, , body]) => body);
const response = (id: string, value: string) => ({ response: { id, value, type: "extension_ui_response" } });

beforeEach(() => {
	vi.useFakeTimers();
	apiMock.mockReset();
	apiMock.mockResolvedValue({});
	useSessions.setState({ list: [session], byId: { [session.id]: session }, loaded: true, loading: false });
	localStorage.clear();
});
afterEach(() => {
	cleanup();
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("pending approval transport scopes", () => {
	const options = ["Approve Directory: /project", "Approve File", "Always Approve Directory: /project", "Always Approve File", "Approve Once", "Deny"];
	it.each([
		["本会话允许目录：/project", "Approve Directory: /project"],
		["本会话允许文件", "Approve File"],
		["始终允许目录：/project", "Always Approve Directory: /project"],
		["始终允许文件", "Always Approve File"],
		["单次允许", "Approve Once"],
	])("keeps cached file scope explicit for %s", async (label, raw) => {
		const entry: PendingEntry = { request: { id: "cached-file", method: "select", title: "Approve file write", options } };
		transport([entry]);
		const c = new ChatController(session.id);
		c.store.setState({ pendings: [entry] });
		render(wrap(c, <PendingCards />));
		expect(screen.queryByRole("button", { name: "本会话记住" })).toBeNull();
		await click(label);
		expect(responses()).toEqual([response("cached-file", raw)]);
	});

	it("never relabels a persistent-only choice as a session grant", async () => {
		const entry: PendingEntry = { request: { id: "persistent", method: "select", title: "Approve command", options: ["Approve", "Always Approve", "Deny"] } };
		transport([entry]);
		const c = new ChatController(session.id);
		c.store.setState({ pendings: [entry] });
		render(wrap(c, <PendingCards />));
		expect(screen.queryByRole("button", { name: /本会话/ })).toBeNull();
		await click("始终允许");
		expect(responses()).toEqual([response("persistent", "Always Approve")]);
	});

	it("sends an offered explicit session choice unchanged", async () => {
		const raw = "Approve bash for this session";
		const entry: PendingEntry = { request: { id: "session", method: "select", title: "Approve command", options: ["Approve", raw, "Deny"] } };
		transport([entry]);
		const c = new ChatController(session.id);
		c.store.setState({ pendings: [entry] });
		render(wrap(c, <PendingCards />));
		await click("本会话允许：bash");
		expect(responses()).toEqual([response("session", raw)]);
	});
});

describe("ask retry and skip transport transitions", () => {
	it("retries the current question after an earlier answer succeeded and later POST failed", async () => {
		const questions = [question("first", "第一题"), question("second", "第二题")];
		const steps = questions.map((q, i) => pending(`post-${i}`, q, i, 2));
		transport(steps, { failPost: "post-1" });
		mountAsk("retry-question-post", questions, steps[0]);
		await choose("甲");
		await click("下一题");
		await choose("乙");
		await click("提交");
		await flushReplies();
		expect(screen.getByText("提交失败")).toBeTruthy();
		expect(screen.getByRole("radio", { name: "乙" }).getAttribute("aria-checked")).toBe("true");
		await choose("甲");
		await click("重试");
		await flushReplies();
		expect(responses()).toEqual([response("post-0", "甲"), response("post-1", "乙"), response("post-1", "甲")]);
		expect(screen.queryByText("提交失败")).toBeNull();
	});

	it("retries a radio answer through an already-open editor without replaying Other or its old note", async () => {
		const questions = [question("single", "选择处理方式")];
		const steps = [pending("radio-select", questions[0], 0, 1), pending("radio-editor", questions[0], 0, 1, 0, true)];
		transport(steps, { failPost: "radio-editor" });
		mountAsk("retry-editor-radio", questions, steps[0]);
		fireEvent.change(screen.getByLabelText("其他回答"), { target: { value: "原先的自定义说明" } });
		await click("提交");
		await flushReplies();
		expect(screen.getByText("提交失败")).toBeTruthy();
		expect(responses()).toEqual([response("radio-select", "Other (type your own)"), response("radio-editor", "原先的自定义说明")]);
		await choose("乙");
		expect((screen.getByLabelText("其他回答") as HTMLInputElement).value).toBe("");
		expect(screen.getByRole("radio", { name: "乙" }).getAttribute("aria-checked")).toBe("true");
		await click("重试");
		await flushReplies();
		expect(responses()).toEqual([
			response("radio-select", "Other (type your own)"), response("radio-editor", "原先的自定义说明"), response("radio-editor", "乙"),
		]);
		expect(screen.queryByText("提交失败")).toBeNull();
		expect(screen.queryByTestId("pending-card")).toBeNull();
	});

	it("does not replay a consumed id when fetching the next question fails", async () => {
		const questions = [question("first", "先回答"), question("second", "再回答")];
		const steps = questions.map((q, i) => pending(`fetch-${i}`, q, i, 2));
		transport(steps, { failGetAfter: "fetch-0" });
		mountAsk("retry-question-fetch", questions, steps[0]);
		await choose("甲");
		await click("下一题");
		await choose("乙");
		await click("提交");
		await flushReplies(5500);
		expect(screen.getByText("提交失败")).toBeTruthy();
		await click("重试");
		await flushReplies();
		expect(responses()).toEqual([response("fetch-0", "甲"), response("fetch-1", "乙")]);
		expect(screen.queryByText("提交失败")).toBeNull();
	});

	it.each([false, true])("preserves checkbox progress after a failed response (consumed=%s)", async (consumed) => {
		const questions = [question("first", "单选"), question("second", "多选", true)];
		const steps = [pending("multi-0", questions[0], 0, 2), pending("multi-1", questions[1], 1, 2), pending("multi-2", questions[1], 1, 2, 1), pending("multi-3", questions[1], 1, 2, 2)];
		transport(steps, { failPost: "multi-2", consumeFailedPost: consumed });
		mountAsk(`retry-multi-selection-${consumed}`, questions, steps[0]);
		await choose("甲");
		await click("下一题");
		await choose("甲", true);
		await choose("乙", true);
		await click("提交");
		await flushReplies();
		expect(screen.getByText("提交失败")).toBeTruthy();
		expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "true"]);
		await click("重试");
		await flushReplies();
		expect(responses()).toEqual([
			response("multi-0", "甲"), response("multi-1", "甲"), response("multi-2", "乙"),
			...(consumed ? [] : [response("multi-2", "乙")]), response("multi-3", "✓ Done selecting"),
		]);
		expect(screen.queryByText("提交失败")).toBeNull();
	});

	it.each(["", "用户自己的说明", "跳过这一题"])("submits only visible selections and intentional note after skip-back-answer (%s)", async (note) => {
		const questions = [question("multi", "可多选", true), question("single", "最后一题")];
		const steps = [
			pending("skip-0", questions[0], 0, 2), pending("skip-1", questions[0], 0, 2, 1),
			...(note ? [pending("skip-editor", questions[0], 0, 2, 0, true)] : []), pending("skip-last", questions[1], 1, 2),
		];
		transport(steps);
		mountAsk(`skip-back-${note || "none"}`, questions, steps[0]);
		if (note) fireEvent.change(screen.getByLabelText("补充说明"), { target: { value: note } });
		await click("跳过");
		await click("上一题");
		expect((screen.getByLabelText("补充说明") as HTMLInputElement).value).toBe(note);
		await choose("乙", true);
		await click("下一题");
		await choose("甲");
		await click("提交");
		await flushReplies();
		expect(responses()).toEqual([
			response("skip-0", "乙"), response("skip-1", note ? "Other (type your own)" : "✓ Done selecting"),
			...(note ? [response("skip-editor", `Selected: 乙; note: ${note}`)] : []), response("skip-last", "甲"),
		]);
	});
});
