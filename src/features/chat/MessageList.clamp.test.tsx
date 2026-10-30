// @vitest-environment jsdom
/**
 * Interim-prose clamping and annotation stability:
 * - only prose that precedes more tool work (and no later steer) may fold;
 * - answers written before a steer and trailing narration stay fully visible;
 * - nothing clamps while a turn is active;
 * - a finishing turn / subagent does not rewrite the disclosure under an
 *   open annotation.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { emptySessionLive, useLive } from "../../stores/live";

vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/ipc")>()),
	rpcSend: vi.fn(async () => ({})),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));

vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/events")>()),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));

import { ExecutionDisclosure } from "./ExecutionDisclosure";
import { MessageList } from "./MessageList";

const item = (partial: Partial<TranscriptItem> & { id: string; kind: TranscriptItem["kind"] }) =>
	({
		parentId: null,
		ts: new Date().toISOString(),
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...partial,
	}) as TranscriptItem;

const call = (id: string) => ({ id, name: "bash", args: {}, intent: null });
const result = (id: string, callId: string) =>
	item({
		id,
		kind: "tool_result",
		toolResult: { toolCallId: callId, toolName: "bash", text: "ok", isError: false, details: null },
	});

const mount = (items: TranscriptItem[]) => {
	useLive.setState({ sessions: { s1: { ...emptySessionLive(), alive: true, items } } });
	const scrollRef = createRef<HTMLDivElement>();
	return render(
		<div ref={scrollRef}>
			<MessageList sessionId="s1" scrollRef={scrollRef} />
		</div>,
	);
};

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	useLive.setState({ sessions: {} });
});
afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

const noFold = (container: HTMLElement) => {
	expect(container.querySelector("[data-clamped-prose]")).toBeNull();
	expect(screen.queryByText("展开全文")).toBeNull();
};

describe("interim prose is never folded", () => {
	it("shows a long formal section that precedes later tool work in full", () => {
		const formal = `## 结论\n\n${"这是一段完整的正式说明。".repeat(80)}`;
		const { container } = mount([
			item({ id: "u1", kind: "user", text: "go" }),
			item({ id: "a1", kind: "assistant", text: formal, toolCalls: [call("c1")], stopReason: "toolUse" }),
			result("r1", "c1"),
			item({ id: "a2", kind: "assistant", text: "all done", stopReason: "stop" }),
		]);
		expect(container.textContent).toContain("这是一段完整的正式说明。".repeat(80));
		noFold(container);
	});

	it("shows the answer written before a steer in full", () => {
		const { container } = mount([
			item({ id: "u1", kind: "user", text: "go" }),
			item({ id: "a1", kind: "assistant", text: "complete answer before the steer", toolCalls: [call("c1")], stopReason: "toolUse" }),
			result("r1", "c1"),
			item({ id: "u2", kind: "user", text: "also check the tests" }),
			item({ id: "a2", kind: "assistant", text: "final after steer", stopReason: "stop" }),
		]);
		expect(screen.getByText("complete answer before the steer")).toBeTruthy();
		noFold(container);
	});

	it("shows trailing narration in full", () => {
		const { container } = mount([
			item({ id: "u1", kind: "user", text: "go" }),
			item({
				id: "a1",
				kind: "assistant",
				text: "spoken final summary",
				toolCalls: [call("c1")],
				stopReason: "stop",
				assistantParts: [
					{ kind: "tool", id: "c1" },
					{ kind: "narration", text: "spoken final summary" },
				],
			}),
			result("r1", "c1"),
		]);
		expect(screen.getByText("spoken final summary")).toBeTruthy();
		noFold(container);
	});

	it("shows interim prose in full while the turn is still streaming", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: [
						item({ id: "u1", kind: "user", text: "go" }),
						item({ id: "a1", kind: "assistant", text: "working note", toolCalls: [call("c1")], stopReason: "toolUse" }),
						result("r1", "c1"),
					],
				},
			},
		});
		const scrollRef = createRef<HTMLDivElement>();
		const { container } = render(
			<div ref={scrollRef}>
				<MessageList sessionId="s1" scrollRef={scrollRef} />
			</div>,
		);
		expect(screen.getByText("working note")).toBeTruthy();
		noFold(container);
	});
});


describe("brief tool transitions", () => {
	it("only a confirmed short lead-in to tool work is foldable when idle", () => {
		const { container } = mount([
			item({ id: "u1", kind: "user", text: "go" }),
			item({ id: "a1", kind: "assistant", text: "先看一下文件。", toolCalls: [call("c1")], stopReason: "toolUse" }),
			result("r1", "c1"),
			item({ id: "a2", kind: "assistant", text: "all done", stopReason: "stop" }),
		]);
		expect(container.querySelectorAll("[data-clamped-prose]")).toHaveLength(1);
	});

	it("never wraps it while the turn is active", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: [
						item({ id: "u1", kind: "user", text: "go" }),
						item({ id: "a1", kind: "assistant", text: "先看一下文件。", toolCalls: [call("c1")], stopReason: "toolUse" }),
						result("r1", "c1"),
					],
				},
			},
		});
		const scrollRef = createRef<HTMLDivElement>();
		const { container } = render(
			<div ref={scrollRef}>
				<MessageList sessionId="s1" scrollRef={scrollRef} />
			</div>,
		);
		expect(container.querySelector("[data-clamped-prose]")).toBeNull();
	});
});

describe("model switch while streaming", () => {
	it("keeps the user turn and the live stream and shows the divider", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: [
						item({ id: "u1", kind: "user", text: "请继续处理" }),
						item({ id: "a1", kind: "assistant", thinking: "plan", toolCalls: [call("c1")], stopReason: "toolUse" }),
						result("r1", "c1"),
					],
					streamingMessage: { role: "assistant", content: [{ type: "thinking", thinking: "third plan" }] } as never,
					state: { model: { provider: "p", id: "m1" }, isStreaming: true },
				},
			},
		});
		const scrollRef = createRef<HTMLDivElement>();
		const { container } = render(
			<div ref={scrollRef}>
				<MessageList sessionId="s1" scrollRef={scrollRef} />
			</div>,
		);
		expect(container.querySelector("#msg-live")).not.toBeNull();
		act(() => {
			useLive.getState().reduceFrame({
				sessionId: "s1",
				frame: {
					type: "response",
					command: "get_state",
					success: true,
					data: { model: { provider: "p", id: "m2" }, isStreaming: true },
				},
			});
		});
		expect(screen.getByText("请继续处理")).toBeTruthy();
		expect(container.querySelector("#msg-live")).not.toBeNull();
		expect(container.textContent).toContain("模型切换 → m2");
		expect(container.textContent).toContain("下一次模型请求起使用新模型");
		expect(screen.getByRole("button", { name: /正在处理/ })).toBeTruthy();
	});
});
describe("annotation stability", () => {
	const steps = [{ id: "t1", kind: "thinking" as const, thinking: "plan" }];
	const view = (streaming: boolean) => (
		<ExecutionDisclosure sessionId="s1" steps={steps} durationMs={5000} isStreaming={streaming} />
	);

	it("keeps the live header while an annotation is open, then releases it", async () => {
		const marker = document.createElement("div");
		marker.setAttribute("data-selection-toolbar-active", "true");
		const { rerender } = render(view(true));
		expect(screen.getByRole("button", { name: /正在处理/ })).toBeTruthy();

		document.body.appendChild(marker);
		rerender(view(false));
		expect(screen.getByRole("button", { name: /正在处理/ })).toBeTruthy();

		act(() => {
			marker.remove();
		});
		await waitFor(() => expect(screen.getByRole("button", { name: /已处理/ })).toBeTruthy());
	});

	it("applies the change immediately when nobody is annotating", () => {
		const { rerender } = render(view(true));
		rerender(view(false));
		expect(screen.getByRole("button", { name: /已处理/ })).toBeTruthy();
	});
});
