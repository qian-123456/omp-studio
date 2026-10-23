// @vitest-environment jsdom
/**
 * Search-hit jump: a pending reveal target (turnNav.revealTurn) is consumed
 * exactly once, only after the session's transcript has loaded, and flashes
 * the matched message's turn.
 */
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { emptySessionLive, useLive } from "../../stores/live";
import { useTurnNav } from "../../stores/turnNav";

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

const transcript = (): TranscriptItem[] => [
	item({ id: "u1", kind: "user", text: "first question" }),
	item({ id: "a1", kind: "assistant", text: "first answer", stopReason: "stop" }),
	item({ id: "u2", kind: "user", text: "second question" }),
	item({ id: "a2", kind: "assistant", text: "needle answer", stopReason: "stop" }),
];

function ui(loading: boolean) {
	const scrollRef = createRef<HTMLDivElement>();
	return (
		<div ref={scrollRef}>
			<MessageList sessionId="s1" scrollRef={scrollRef} isLoadingTranscript={loading} />
		</div>
	);
}

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
	Element.prototype.scrollIntoView = vi.fn();
	useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: [] } } });
	useTurnNav.setState({ revealTurn: null });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("pending reveal target", () => {
	it("waits for the transcript, then is consumed once and flashes the matched turn", () => {
		useTurnNav.getState().showTurn("s1", "a2");
		const { rerender, container } = render(ui(true));
		// transcript still loading: target stays pending
		expect(useTurnNav.getState().revealTurn).not.toBeNull();

		// loading flag drops before any item arrived: still pending (no empty-list consume)
		rerender(ui(false));
		expect(useTurnNav.getState().revealTurn).not.toBeNull();

		act(() => {
			useLive.getState().setItems("s1", transcript(), 100);
		});
		expect(useTurnNav.getState().revealTurn).toBeNull();

		const flashed = container.querySelectorAll("[data-turn-id].bg-\\[var\\(--ghost-hover\\)\\]");
		expect(flashed).toHaveLength(1);
		expect(flashed[0].textContent).toContain("needle answer");
	});

	it("ignores a target that belongs to another session", () => {
		useTurnNav.getState().showTurn("other", "a2");
		useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: transcript() } } });
		render(ui(false));
		expect(useTurnNav.getState().revealTurn).not.toBeNull();
	});

	it("drops a target whose entry is not in a loaded transcript without flashing", () => {
		useLive.setState({ sessions: { s1: { ...emptySessionLive(), items: transcript() } } });
		useTurnNav.getState().showTurn("s1", "missing");
		const { container } = render(ui(false));
		expect(useTurnNav.getState().revealTurn).toBeNull();
		expect(container.querySelector(".bg-\\[var\\(--ghost-hover\\)\\]")).toBeNull();
	});
});
