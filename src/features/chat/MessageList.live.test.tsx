// @vitest-environment jsdom
/**
 * Live turn rendering: an in-progress turn keeps every step open under one
 * 「正在处理」 header, and a session switch never paints the previous
 * session's held live frame.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { emptySessionLive, useLive } from "../../stores/live";

import { useSessions } from "../../stores/sessions";
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/ipc")>()),
	rpcSend: vi.fn(async () => ({})),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));

vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/events")>()),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));

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

const persisted = (): TranscriptItem[] => [
	item({ id: "u1", kind: "user", text: "do it" }),
	item({
		id: "a1",
		kind: "assistant",
		thinking: "first plan",
		toolCalls: [{ id: "c1", name: "bash", args: {}, intent: null }],
		stopReason: "toolUse",
	}),
	item({
		id: "r1",
		kind: "tool_result",
		toolResult: { toolCallId: "c1", toolName: "bash", text: "ok", isError: false, details: null },
	}),
];

const streamingMessage = (thinking: string) =>
	({
		role: "assistant",
		content: [{ type: "thinking", thinking }],
	}) as never;

const mount = (sessionId: string, props: { transcriptError?: string; onRetryTranscript?: () => void } = {}) => {
	const scrollRef = createRef<HTMLDivElement>();
	return render(
		<div ref={scrollRef}>
			<MessageList sessionId={sessionId} scrollRef={scrollRef} {...props} />
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
	// jsdom has no layout: give the virtualizer a viewport so rows render.
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} });
});
afterEach(cleanup);

describe("MessageList live turn", () => {
	it("keeps persisted + live steps of an in-progress turn open under one header", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: persisted(),
					streamingMessage: streamingMessage("third plan"),
				},
			},
		});
		mount("s1");
		const headers = screen.getAllByRole("button", { name: /正在处理|已处理/ });
		expect(headers).toHaveLength(1);
		expect(headers[0].textContent).toMatch(/正在处理/);
		expect(headers[0].getAttribute("aria-expanded")).toBe("true");
		expect(screen.queryByText(/已处理/)).toBeNull();
	});

	it("does not replay committed prose or request errors below newer tool activity", () => {
		const SID = "committed-live-requests";
		const reduce = (frame: Record<string, unknown>) => useLive.getState().reduceFrame({ sessionId: SID, frame });
		reduce({ type: "agent_start" });
		reduce({
			type: "message_end",
			message: { role: "assistant", id: "old-prose", completedAt: 1000, content: [{ type: "text", text: "Earlier completed prose" }] },
		});
		reduce({
			type: "message_end",
			message: { role: "assistant", id: "old-error", completedAt: 2000, content: [], stopReason: "error", errorMessage: "Old 429 request failure" },
		});
		const history = [
			item({ id: "user", kind: "user", text: "continue", ts: new Date(0).toISOString() }),
			item({ id: "committed-prose", kind: "assistant", text: "Earlier completed prose", completedAt: 1000 }),
			item({ id: "committed-error", kind: "assistant", text: "Old 429 request failure", stopReason: "error", completedAt: 2000 }),
			...persisted().slice(1),
		];
		useLive.getState().setItems(SID, history, 50);
		reduce({ type: "tool_execution_start", toolCallId: "new-call", toolName: "read", args: {}, intent: "Current tool activity" });
		const { container } = mount(SID);
		expect(screen.getAllByText("Earlier completed prose")).toHaveLength(1);
		expect(container.querySelector("#msg-live")?.textContent).not.toContain("Old 429 request failure");
		expect(container.querySelector("#msg-live")?.textContent).not.toContain("Earlier completed prose");
		act(() => {
			reduce({
				type: "message_end",
				message: { role: "assistant", id: "new-error", completedAt: 3000, content: [], stopReason: "error", errorMessage: "Current request failure" },
			});
		});
		expect(container.querySelector("#msg-live")?.textContent).toContain("Current request failure");
	});

	it("drops the previous session's live frame on switch", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: persisted(),
					streamingMessage: streamingMessage("third plan"),
				},
				s2: { ...emptySessionLive(), alive: true, items: [] },
			},
		});
		const scrollRef = createRef<HTMLDivElement>();
		const ui = (sid: string) => (
			<div ref={scrollRef}>
				<MessageList sessionId={sid} scrollRef={scrollRef} />
			</div>
		);
		const { rerender, container } = render(ui("s1"));
		expect(container.querySelector("#msg-live")).not.toBeNull();
		act(() => {
			rerender(ui("s2"));
		});
		expect(container.querySelector("#msg-live")).toBeNull();
		expect(screen.queryByText(/已处理|正在处理/)).toBeNull();
	});

	it("drops the held live row when the answer lands in an already-committed turn", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: persisted(),
					streamingMessage: {
						role: "assistant",
						content: [{ type: "text", text: "最终答案" }],
					} as never,
				},
			},
		});
		const { container } = mount("s1");
		expect(container.querySelector("#msg-live")).not.toBeNull();
		// Stream ends: the live row is held until the transcript catches up.
		act(() => {
			useLive.setState((s) => ({
				sessions: { s1: { ...s.sessions.s1, streaming: false, streamingMessage: null } },
			}));
		});
		expect(container.querySelector("#msg-live")).not.toBeNull();
		// The answer joins the same turn block (same block count and first id).
		act(() => {
			useLive
				.getState()
				.appendItems("s1", [item({ id: "a2", kind: "assistant", text: "最终答案" })], 20);
		});
		expect(container.querySelector("#msg-live")).toBeNull();
		expect(screen.getAllByText("最终答案")).toHaveLength(1);
	});

	it("keeps the finished answer across empty pages until its full text is committed", () => {
		vi.useFakeTimers();
		try {
			useLive.setState({
				sessions: {
					s1: {
						...emptySessionLive(),
						alive: true,
						streaming: true,
						items: persisted(),
						streamingMessage: { role: "assistant", content: [{ type: "text", text: "最终答案" }] } as never,
					},
				},
			});
			const { container } = mount("s1");
			act(() => {
				useLive.setState((s) => ({
					sessions: { s1: { ...s.sessions.s1, streaming: false, streamingMessage: null } },
				}));
			});
			// The refresh is slow: the answer must not vanish (leaving the previous reply at the bottom).
			act(() => {
				vi.advanceTimersByTime(5000);
			});
			expect(container.querySelector("#msg-live")).not.toBeNull();
			// A successful but empty read cannot replace text already shown to the user.
			act(() => {
				useLive.getState().appendItems("s1", [], 20);
			});
			expect(container.querySelector("#msg-live")).not.toBeNull();
			expect(screen.getByText("最终答案")).toBeTruthy();
			act(() => useLive.getState().appendItems("s1", [item({ id: "a2", kind: "assistant", text: "最终答案" })], 30));
			expect(container.querySelector("#msg-live")).toBeNull();
			expect(screen.getAllByText("最终答案")).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("held row after agent_end repeats neither committed steps nor delivered steers", () => {
		const req = {
			id: "a1",
			toolCallIds: ["c1"],
			parts: [{ kind: "tool", id: "c1" }],
			stat: { error: null, startedAt: 1, completedAt: 2, durationMs: 1000 },
		};
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: persisted(),
					streamingMessage: streamingMessage("third plan"),
					liveRequests: [req] as never,
					tools: {
						c1: { toolCallId: "c1", toolName: "bash", args: {}, intent: "DUP-STEP", status: "done", text: "", details: null, startedAt: 1 },
					} as never,
					pendingUserEchoes: [
						{ ...item({ id: "e1", kind: "user", text: "STEER-TXT" }), steer: true, delivered: true },
					] as never,
				},
			},
		});
		mount("s1");
		act(() => {
			useLive.setState((s) => ({
				sessions: {
					s1: {
						...s.sessions.s1,
						streaming: false,
						streamingMessage: null,
						liveRequests: [],
						tools: {},
					},
				},
			}));
		});
		// Held: still one disclosure header (the committed turn's), one steer copy.
		expect(screen.getAllByRole("button", { name: /正在处理|已处理/ })).toHaveLength(1);
		expect(screen.getAllByText("STEER-TXT")).toHaveLength(1);
	});

	it("keeps retry rows at the point they happened, not pinned under newer steps", () => {
		const stat = (error: string | null) => ({ error, startedAt: 1, completedAt: 2, durationMs: 1000 });
		const req = (id: string, error: string | null, toolCallIds: string[] = []) => ({
			id,
			toolCallIds,
			parts: toolCallIds.map((tid) => ({ kind: "tool", id: tid })),
			stat: stat(error),
		});
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					alive: true,
					streaming: true,
					items: [item({ id: "u1", kind: "user", text: "go" })],
					streamingMessage: streamingMessage("later work"),
					liveRequests: [req("q1", "socket closed"), req("q2", null, ["c9"])] as never,
					tools: {
						c9: { toolCallId: "c9", toolName: "bash", args: { command: "echo hi" }, intent: "Later step", status: "done", text: "", details: null, startedAt: 1 },
					} as never,
					// Raised after q1 failed; the turn then kept working (q2).
					retryNotices: [
						{ id: 1, kind: "retry", tone: "warn", text: "RETRY-ROW", ts: 1, anchor: 1 },
					],
				},
			},
		});
		const { container } = mount("s1");
		const retry = container.querySelector("[data-retry-notices]");
		const later = screen.getByText(/Later step/);
		expect(retry).not.toBeNull();
		// The retry row precedes the step that ran after the retry succeeded.
		expect(
			retry!.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		// ...and is rendered once, inside the live row (no tail copy).
		expect(container.querySelectorAll("[data-retry-notices]")).toHaveLength(1);
		expect(container.querySelector("#msg-live")?.contains(retry)).toBe(true);
	});

	describe("turn with still-running subagents", () => {
		const subTurn = (): TranscriptItem[] => [
			item({ id: "u1", kind: "user", text: "scout it", ts: "2026-10-21T23:04:00.000Z" }),
			item({
				id: "a1",
				kind: "assistant",
				toolCalls: [{ id: "task1", name: "task", args: {}, intent: null }],
				stopReason: "toolUse",
				ts: "2026-10-21T23:04:30.000Z",
			}),
			item({
				id: "r1",
				kind: "tool_result",
				toolResult: { toolCallId: "task1", toolName: "task", text: "ok", isError: false, details: null },
				ts: "2026-10-21T23:04:46.000Z",
			}),
			item({ id: "a2", kind: "assistant", text: "waiting", stopReason: "stop", ts: "2026-10-21T23:04:46.000Z" }),
		];

		const setSubagents = (subagents: Record<string, unknown>) =>
			useLive.setState({
				sessions: {
					s1: { ...emptySessionLive(), alive: true, items: subTurn(), subagents: subagents as never },
				},
			});

		it("stays 正在处理 while a dispatched subagent runs, never a short 已处理", () => {
			setSubagents({ sa1: { status: "running", label: "scout", parentToolCallId: "task1" } });
			mount("s1");
			const header = screen.getByRole("button", { name: /正在处理|已处理/ });
			expect(header.textContent).toMatch(/正在处理/);
			expect(header.textContent).not.toMatch(/已处理/);
		});

		it("settles on a duration covering the subagents once they finish", () => {
			setSubagents({
				sa1: {
					status: "completed",
					label: "scout",
					parentToolCallId: "task1",
					lastUpdate: Date.parse("2026-10-21T23:16:46.000Z"),
				},
			});
			mount("s1");
			const header = screen.getByRole("button", { name: /正在处理|已处理/ });
			// 46s of parent work + 12min of subagent tail = 12分46秒.
			expect(header.textContent).toMatch(/已处理 12分46秒/);
		});

		it("keeps the parent-only duration for a turn without subagents", () => {
			setSubagents({});
			mount("s1");
			expect(screen.getByRole("button", { name: /已处理/ }).textContent).toMatch(/已处理 46秒/);
		});
	});
});

describe("live narration visibility", () => {
	it.each(["message_update", "message_end"])("renders narration in source order for %s", (type) => {
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "s1", frame: {
			type,
			message: { role: "assistant", content: [
				{ type: "thinking", thinking: "first spoken update", narration: true },
				{ type: "toolCall", id: "read-call", name: "read", arguments: { path: "/example.txt" } },
				{ type: "text", text: "second spoken update", narration: true },
			] },
		} });
		mount("s1");
		const first = screen.getByText("first spoken update");
		const second = screen.getByText("second spoken update");
		expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.queryByRole("button", { name: /正在思考|已思考/ })).toBeNull();
	});
});

describe("committed stopped answers", () => {
	it("keeps a nonempty aborted answer readable beside its stopped indicator", () => {
		useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: [
			item({ id: "u1", kind: "user", text: "Explain", ts: "2026-11-01T12:00:00.000Z" }),
			item({ id: "a1", kind: "assistant", text: "Partial generated answer remains readable", stopReason: "aborted", ts: "2026-11-01T12:00:03.000Z" }),
		] } } });
		mount("s1");
		expect(screen.getByText("Partial generated answer remains readable")).toBeTruthy();
		expect(screen.getByText(/^已停止|^Stopped/)).toBeTruthy();
		expect(screen.queryByText(/空回复|Empty reply/)).toBeNull();
	});

	it("shows the stopped indicator rather than an empty reply for a blank aborted answer", () => {
		useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: [
			item({ id: "u1", kind: "user", text: "Explain", ts: "2026-11-01T12:00:00.000Z" }),
			item({ id: "a1", kind: "assistant", text: "", stopReason: "aborted", ts: "2026-11-01T12:00:03.000Z" }),
		] } } });
		mount("s1");
		expect(screen.getByText(/^已停止|^Stopped/)).toBeTruthy();
		expect(screen.queryByText(/空回复|Empty reply/)).toBeNull();
	});
});

describe("history read failure with retained content", () => {
	it.each(["cached", "pending"] as const)("keeps %s content visible with the full error and an operable retry", (source) => {
		if (source === "cached") {
			useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: [item({ id: "u1", kind: "user", text: "Retained cached question" })] } } });
		} else {
			useLive.getState().addUserEcho("s1", "Retained pending question");
		}
		const retry = vi.fn();
		const error = "History unavailable: permission denied\nThe cached messages are still available.";
		mount("s1", { transcriptError: error, onRetryTranscript: retry });
		expect(screen.getByText(`Retained ${source} question`)).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain(error);
		fireEvent.click(screen.getByRole("button", { name: /重试加载|Retry loading/ }));
		expect(retry).toHaveBeenCalledOnce();
		expect(screen.getByText(`Retained ${source} question`)).toBeTruthy();
	});
});

describe("new side chat inherited history boundary", () => {
	it.each([false, true])("keeps pending and live content while waiting for its own boundary (nested=%s)", (nested) => {
		const inherited = nested ? [
			item({ id: "parent-boundary", kind: "user", text: "Side chat forked from main session\n## User question\nInherited parent question" }),
			item({ id: "parent-answer", kind: "assistant", text: "Inherited parent answer" }),
		] : [];
		useSessions.setState({ sessions: { child: { id: "child", forkDepth: 2 } as never } });
		useLive.setState({ sessions: { child: {
			...emptySessionLive(), alive: true, streaming: true, items: inherited,
			sideChatInheritedIds: inherited.map((row) => row.id),
			streamingMessage: { role: "assistant", content: [{ type: "text", text: "Current committed child answer" }] } as never,
		} } });
		useLive.getState().addUserEcho("child", "Current child question");
		mount("child");
		expect(screen.getByText("Current child question")).toBeTruthy();
		expect(screen.getByText("Current committed child answer")).toBeTruthy();
		expect(screen.queryByText("Inherited parent question")).toBeNull();
		expect(screen.queryByText("Inherited parent answer")).toBeNull();
		act(() => {
			useLive.getState().reduceFrame({ sessionId: "child", frame: { type: "agent_end" } });
			useLive.getState().appendItems("child", [
				item({ id: "own-boundary", kind: "user", hidden: true, text: "Side chat forked from main session\n## User question\nCurrent child question" }),
				item({ id: "own-answer", kind: "assistant", text: "Current committed child answer" }),
			], 20);
		});
		expect(useLive.getState().sessions.child.sideChatInheritedIds).toBeUndefined();
		expect(screen.getAllByText("Current child question")).toHaveLength(1);
		expect(screen.getByText("Current committed child answer")).toBeTruthy();
		expect(screen.queryByText("Inherited parent question")).toBeNull();
		expect(screen.queryByText("Inherited parent answer")).toBeNull();
	});
});

describe("agent_end answer handoff", () => {
	it.each(["message_update", "message_end"] as const)("keeps %s prose readable after real agent_end until delayed history arrives", (frameType) => {
		vi.useFakeTimers();
		try {
			useLive.getState().setItems("s1", [item({ id: "u1", kind: "user", text: "Explain the result" })], 1);
			useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: frameType, message: { role: "assistant", id: "answer-request", completedAt: 2000, stopReason: "stop", content: [{ type: "text", text: "The final visible answer" }] } } });
			const { container } = mount("s1");
			expect(screen.getByText("The final visible answer")).toBeTruthy();
			act(() => useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_end" } }));
			act(() => vi.advanceTimersByTime(30_000));
			expect(screen.getAllByText("The final visible answer")).toHaveLength(1);
			expect(container.querySelector("#msg-live")).not.toBeNull();
			act(() => useLive.getState().appendItems("s1", [], 2));
			expect(screen.getAllByText("The final visible answer")).toHaveLength(1);
			act(() => useLive.getState().setItems("s1", [
				item({ id: "u1", kind: "user", text: "Explain the result" }),
				item({ id: "persisted-answer", kind: "assistant", text: "The final visible", completedAt: 2000 }),
			], 2));
			expect(screen.getAllByText("The final visible answer")).toHaveLength(1);
			expect(screen.queryByText("The final visible")).toBeNull();
			expect(container.querySelector("#msg-live")).not.toBeNull();
			act(() => useLive.getState().setItems("s1", [
				item({ id: "u1", kind: "user", text: "Explain the result" }),
				item({ id: "persisted-answer", kind: "assistant", text: "The final visible answer", completedAt: 2000 }),
			], 3));
			expect(screen.getAllByText("The final visible answer")).toHaveLength(1);
			expect(container.querySelector("#msg-live")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps completed request prose beside a failed history read and retries without blanking it", () => {
		vi.useFakeTimers();
		try {
			useLive.getState().setItems("s1", [item({ id: "u1", kind: "user", text: "Explain the result" })], 1);
			useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "message_end", message: { role: "assistant", id: "answer-request", completedAt: 2000, stopReason: "stop", content: [{ type: "text", text: "Answer waiting for history" }] } } });
			const scrollRef = createRef<HTMLDivElement>();
			const retry = vi.fn(() => {
				useLive.getState().appendItems("s1", [item({ id: "persisted-answer", kind: "assistant", text: "Answer waiting for history", completedAt: 2000 })], 2);
			});
			const view = (error: string | null) => (
				<div ref={scrollRef}><MessageList sessionId="s1" scrollRef={scrollRef} transcriptError={error} onRetryTranscript={retry} /></div>
			);
			const { rerender, container } = render(view(null));
			expect(screen.getByText("Answer waiting for history")).toBeTruthy();
			act(() => useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_end" } }));
			rerender(view("History read failed: disk is unavailable"));
			act(() => vi.advanceTimersByTime(30_000));
			expect(screen.getByText("Answer waiting for history")).toBeTruthy();
			expect(screen.getByRole("alert").textContent).toContain("History read failed: disk is unavailable");
			fireEvent.click(screen.getByRole("button", { name: /重试加载|Retry loading/ }));
			expect(retry).toHaveBeenCalledOnce();
			rerender(view(null));
			expect(screen.getAllByText("Answer waiting for history")).toHaveLength(1);
			expect(screen.queryByRole("alert")).toBeNull();
			expect(container.querySelector("#msg-live")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("waits for every completed request's full multipart prose, not only the final answer", () => {
		const question = item({ id: "u1", kind: "user", text: "Explain the result" });
		useLive.getState().setItems("s1", [question], 1);
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "message_end", message: { role: "assistant", id: "earlier-request", completedAt: 1000, content: [
			{ type: "text", text: "Earlier first part" }, { type: "text", text: "Earlier second part" },
		] } } });
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "message_end", message: { role: "assistant", id: "final-request", completedAt: 2000, content: [{ type: "text", text: "Final complete answer" }] } } });
		const { container } = mount("s1");
		expect(screen.getByText("Final complete answer")).toBeTruthy();
		act(() => useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_end" } }));
		const answer = item({ id: "persisted-answer", kind: "assistant", text: "Final complete answer", completedAt: 2000 });
		act(() => useLive.getState().setItems("s1", [question, answer], 2));
		expect(container.querySelector("#msg-live")).not.toBeNull();
		expect(screen.getByText("Earlier first part")).toBeTruthy();
		expect(screen.getByText("Earlier second part")).toBeTruthy();
		expect(screen.getAllByText("Final complete answer")).toHaveLength(1);
		act(() => useLive.getState().setItems("s1", [question,
			item({ id: "earlier-prose", kind: "assistant", text: "Earlier first part\n\nEarlier second part", completedAt: 1000 }), answer,
		], 3));
		expect(container.querySelector("#msg-live")).toBeNull();
		expect(screen.getAllByText("Earlier first part")).toHaveLength(1);
		expect(screen.getAllByText("Earlier second part")).toHaveLength(1);
		expect(screen.getAllByText("Final complete answer")).toHaveLength(1);
	});

	it("hands off once when agent_end and the complete transcript page arrive in the same React batch", () => {
		const question = item({ id: "u1", kind: "user", text: "Explain the result" });
		useLive.getState().setItems("s1", [question], 1);
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "message_end", message: { role: "assistant", id: "request", completedAt: 2000, content: [{ type: "text", text: "Answer committed in the same batch" }] } } });
		const { container } = mount("s1");
		expect(screen.getAllByText("Answer committed in the same batch")).toHaveLength(1);
		act(() => {
			useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_end" } });
			useLive.getState().appendItems("s1", [item({ id: "answer", kind: "assistant", text: "Answer committed in the same batch", completedAt: 2000 })], 2);
		});
		expect(screen.getAllByText("Answer committed in the same batch")).toHaveLength(1);
		expect(container.querySelector("#msg-live")).toBeNull();
	});

	it.each([undefined, 1000])("does not treat display-stat fallback timing as a completedAt identity (timestamp=%s)", (timestamp) => {
		const question = item({ id: "u1", kind: "user", text: "Explain the result" });
		useLive.getState().setItems("s1", [question], 1);
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "message_end", message: { role: "assistant", id: "request", ...(timestamp === undefined ? {} : { timestamp }), content: [{ type: "text", text: "Full answer without completion metadata" }] } } });
		const { container } = mount("s1");
		act(() => useLive.getState().reduceFrame({ sessionId: "s1", frame: { type: "agent_end" } }));
		act(() => useLive.getState().setItems("s1", [question, item({ id: "answer", kind: "assistant", text: "without completion metadata", completedAt: null, ts: new Date(2000).toISOString() })], 2));
		expect(screen.getAllByText("Full answer without completion metadata")).toHaveLength(1);
		expect(container.querySelector("#msg-live")).not.toBeNull();
		act(() => useLive.getState().setItems("s1", [question, item({ id: "answer", kind: "assistant", text: "Full answer without completion metadata", completedAt: null, ts: new Date(2000).toISOString() })], 3));
		expect(screen.getAllByText("Full answer without completion metadata")).toHaveLength(1);
		expect(container.querySelector("#msg-live")).toBeNull();
	});

	it("does not prematurely drop a side-chat live answer when inherited parent history contains the same text", () => {
		useSessions.setState({
			sessions: {
				side: { id: "side", parentId: "main", forkDepth: 1, status: "idle" } as never,
			},
		});
		const inherited = [
			item({ id: "parent-u", kind: "user", text: "Parent question" }),
			item({ id: "parent-a", kind: "assistant", text: "Shared conclusion text", completedAt: 2000 }),
			item({
				id: "side-q",
				kind: "user",
				text: "Side chat forked from main session\n## User question\nConfirm conclusion",
				hidden: true,
			}),
		];
		useLive.getState().setItems("side", inherited, 10);
		useLive.getState().reduceFrame({ sessionId: "side", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({
			sessionId: "side",
			frame: {
				type: "message_end",
				message: {
					role: "assistant",
					id: "side-live",
					completedAt: 2000,
					content: [{ type: "text", text: "Shared conclusion text" }],
				},
			},
		});
		const { container } = mount("side");
		expect(screen.getAllByText("Shared conclusion text")).toHaveLength(1);
		act(() => {
			useLive.getState().reduceFrame({ sessionId: "side", frame: { type: "agent_end" } });
			// Partial page update where side-chat answer hasn't landed yet, only inherited parent has it!
			useLive.getState().setItems("side", [...inherited], 11);
		});
		// Must keep holding #msg-live so the side-chat reply never vanishes!
		expect(container.querySelector("#msg-live")).not.toBeNull();
		expect(screen.getAllByText("Shared conclusion text")).toHaveLength(1);

		// Once the side chat's own persisted answer arrives after side-q, hold releases cleanly.
		act(() => {
			useLive.getState().setItems(
				"side",
				[
					...inherited,
					item({ id: "side-a", kind: "assistant", text: "Shared conclusion text", completedAt: 2000 }),
				],
				20,
			);
		});
		expect(container.querySelector("#msg-live")).toBeNull();
		expect(screen.getAllByText("Shared conclusion text")).toHaveLength(1);
	});

	it("preserves partial prose and renders a full inline error card with retry and switch-model buttons when a turn errors", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					items: [
						item({ id: "u1", kind: "user", text: "Generate report" }),
						item({
							id: "a1",
							kind: "assistant",
							text: "Halfway streamed paragraph before disconnect",
							errorMessage: "502 Bad Gateway: upstream stream terminated unexpectedly",
							stopReason: "error",
						}),
					],
				},
			},
		});
		mount("s1");
		expect(screen.getByText("Halfway streamed paragraph before disconnect")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain(
			"502 Bad Gateway: upstream stream terminated unexpectedly",
		);
		expect(screen.getByRole("button", { name: /重试这一轮|Retry This Turn/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /换成别的模型|Switch Model/ })).toBeTruthy();
	});

	it("shows an explicit notice and recovery buttons when steps ran without generating a final text reply", () => {
		useLive.setState({
			sessions: {
				s1: {
					...emptySessionLive(),
					items: [
						item({ id: "u1", kind: "user", text: "Check files" }),
						item({
							id: "a1",
							kind: "assistant",
							text: null,
							toolCalls: [{ id: "c1", name: "read", args: { path: "a.ts" }, intent: "Read a.ts" }],
						}),
						item({
							id: "r1",
							kind: "tool_result",
							toolResult: { toolCallId: "c1", toolName: "read", text: "ok", isError: false, details: null },
						}),
					],
				},
			},
		});
		mount("s1");
		expect(screen.getByText(/已完成上述处理步骤|Completed the steps above/)).toBeTruthy();
		expect(screen.getByRole("button", { name: /展开查看过程|View Steps/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /重试这一轮|Retry This Turn/ })).toBeTruthy();
	});
});
