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
});
