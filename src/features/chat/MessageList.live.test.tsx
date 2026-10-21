// @vitest-environment jsdom
/**
 * Live turn rendering: an in-progress turn keeps every step open under one
 * 「正在处理」 header, and a session switch never paints the previous
 * session's held live frame.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
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

const mount = (sessionId: string) => {
	const scrollRef = createRef<HTMLDivElement>();
	return render(
		<div ref={scrollRef}>
			<MessageList sessionId={sessionId} scrollRef={scrollRef} />
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
