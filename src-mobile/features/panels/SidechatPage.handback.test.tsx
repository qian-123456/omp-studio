// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import { nav } from "../../core/nav";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import type { MobileSession, RpcFrame, TranscriptItem, TranscriptPage } from "../../core/types";
import { loadUnsent, saveUnsent } from "../chat/lib/unsent";
import { HANDBACK_PROMPT, SidechatPage } from "./SidechatPage";

vi.mock("../../core/nav", () => ({
	nav: { push: vi.fn(), pushLayer: () => () => {} },
	paths: { chat: (id: string) => `/s/${id}` },
}));

const thread: MobileSession = {
	id: "thread",
	label: "#2",
	title: "方案讨论",
	status: "review",
	updatedAt: "2026-10-27T10:00:00Z",
	cwd: "/project",
	live: true,
};

let transcript: TranscriptItem[];
let requests: number;
let delayedTranscript: Promise<TranscriptPage> | null;

const flush = async () => {
	await act(async () => {});
};
const fetchDebounce = async () => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(400);
	});
};
const emit = (frame: RpcFrame) => {
	act(() => events.emit("rpc", { sessionId: "thread", frame }));
};
const status = (next: MobileSession["status"]) => {
	act(() => useSessions.getState().patch("thread", { status: next }));
};
const conclusion = () => screen.getByRole("textbox", { name: "结论" }) as HTMLTextAreaElement;
// Button's status spinner contributes its loading label to the accessible name while busy.
const summarize = () => screen.getByRole("button", { name: /^(?:加载中)?(让 AI 整理|重新整理)$/ }) as HTMLButtonElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

async function openSummary() {
	render(<SidechatPage route={{ name: "sidechat", path: "/s/parent/sidechat", params: { id: "parent" }, query: {} }} />);
	await flush();
	fireEvent.click(screen.getByRole("button", { name: /方案讨论/ }));
	await flush();
	fireEvent.click(button("整理结论发回主对话"));
	await flush();
	expect(summarize().getAttribute("aria-busy")).toBe("true");
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	localStorage.clear();
	requests = 0;
	delayedTranscript = null;
	transcript = [{ id: "question", kind: "user", text: "比较两个方案" }];
	useSessions.setState({ list: [thread], byId: { thread }, loaded: true, loading: false });
	vi.spyOn(apiModule, "api").mockImplementation(async (method, path, body) => {
		if (method === "GET" && path.endsWith("/sidechats")) return [thread];
		if (method === "GET" && path.includes("/transcript?")) {
			if (delayedTranscript) {
				const next = delayedTranscript;
				delayedTranscript = null;
				return next;
			}
			return { items: [...transcript], reset: true };
		}
		if (method === "POST" && path === "/sessions/thread/prompt") {
			requests++;
			expect(body).toEqual({ text: HANDBACK_PROMPT });
			transcript.push({ id: `summary-${requests}`, kind: "user", text: HANDBACK_PROMPT });
			useSessions.getState().patch("thread", { status: "working" });
			return {};
		}
		if (method === "POST" && path === "/sessions/parent/prompt") return {};
		throw new Error(`Unexpected API call: ${method} ${path}`);
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("sidechat summary terminal recovery", () => {
	it.each([
		{ stopReason: "error", finalStatus: "error" as const, action: "放进输入框" },
		{ stopReason: "aborted", finalStatus: "review" as const, action: "直接发送" },
	])("releases a no-text $stopReason completion for manual $action", async ({ stopReason, finalStatus, action }) => {
		await openSummary();
		await fetchDebounce();
		// Catalog maps terminal errors to error and other terminal ends (including abort) to review.
		status(finalStatus);
		const message = { role: "assistant", content: [], stopReason };
		emit({ type: "message_end", message });
		emit({ type: "agent_end", isTerminal: true });
		await fetchDebounce();

		expect(summarize().disabled).toBe(false);
		expect(screen.queryByText("正在整理结论")).toBeNull();
		expect(conclusion().value).toBe("");
		expect(button(action).disabled).toBe(true);
		saveUnsent("parent", "原有草稿");
		fireEvent.change(conclusion(), { target: { value: "手动确认：采用方案 B" } });
		expect(button(action).disabled).toBe(false);
		fireEvent.click(button(action));
		await flush();

		if (action === "放进输入框") {
			expect(loadUnsent("parent")).toBe("原有草稿\n\n[来自辅助对话：方案讨论]\n> 手动确认：采用方案 B");
			expect(apiModule.api).not.toHaveBeenCalledWith("POST", "/sessions/parent/prompt", expect.anything());
		} else {
			expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/parent/prompt", {
				text: "[来自辅助对话：方案讨论]\n\n手动确认：采用方案 B",
			});
		}
		expect(nav.push).toHaveBeenCalledWith("/s/parent");
	});

	it("can retry after an accepted summary finishes without assistant text", async () => {
		await openSummary();
		status("error");
		emit({ type: "agent_end", isTerminal: true });
		await fetchDebounce();
		fireEvent.click(summarize());
		await flush();
		expect(requests).toBe(2);
		expect(apiModule.api).toHaveBeenCalledWith("POST", "/sessions/thread/prompt", { text: HANDBACK_PROMPT });
		expect(summarize().getAttribute("aria-busy")).toBe("true");
		transcript.push({ id: "retry-answer", kind: "assistant", text: "重试结论：采用方案 B" });
		status("review");
		emit({ type: "agent_end", isTerminal: true });
		await fetchDebounce();
		expect(conclusion().value).toBe("重试结论：采用方案 B");
		expect(summarize().disabled).toBe(false);
		expect(button("直接发送").disabled).toBe(false);
	});

	it("keeps streaming and background continuations busy until the final successful reply is fetched", async () => {
		await openSummary();
		transcript.push({ id: "answer", kind: "assistant", text: "正在整理的结论" });
		emit({ type: "message_update", message: { role: "assistant", content: [] } });
		await fetchDebounce();
		expect(conclusion().value).toBe("正在整理的结论");
		expect(button("直接发送").disabled).toBe(true);

		// Background waits settle the catalog badge but are not terminal summary completion.
		status("review");
		emit({ type: "agent_end", isTerminal: false, awaitingAsyncWork: true });
		await fetchDebounce();
		expect(summarize().getAttribute("aria-busy")).toBe("true");
		emit({ type: "agent_start" });
		status("working");
		emit({ type: "agent_end", isTerminal: false });
		emit({ type: "turn_end" });
		await fetchDebounce();
		expect(summarize().getAttribute("aria-busy")).toBe("true");

		transcript[transcript.length - 1] = { id: "answer", kind: "assistant", text: "最终结论：采用方案 B" };
		status("review");
		emit({ type: "agent_end", isTerminal: true });
		expect(summarize().getAttribute("aria-busy")).toBe("true");
		await fetchDebounce();
		expect(conclusion().value).toBe("最终结论：采用方案 B");
		expect(button("放进输入框").disabled).toBe(false);
		expect(button("直接发送").disabled).toBe(false);
	});

	it("does not settle from a transcript request that started before the terminal event", async () => {
		await openSummary();
		// The mobile project's ES2021 library target does not expose Promise.withResolvers.
		let resolveOld!: (page: TranscriptPage) => void;
		delayedTranscript = new Promise((resolve) => { resolveOld = resolve; });
		await fetchDebounce();
		status("review");
		emit({ type: "agent_end", isTerminal: true });
		await act(async () => resolveOld({ items: [...transcript], reset: true }));
		expect(summarize().getAttribute("aria-busy")).toBe("true");
		transcript.push({ id: "final-answer", kind: "assistant", text: "完整结论" });
		await fetchDebounce();
		expect(conclusion().value).toBe("完整结论");
		expect(summarize().disabled).toBe(false);
	});
});
