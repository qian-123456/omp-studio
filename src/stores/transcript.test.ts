import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem, TranscriptPage } from "../lib/contracts";
import type * as IpcModule from "../lib/ipc";

const h = vi.hoisted(() => ({ getTranscript: vi.fn(), localRowsGet: vi.fn() }));
vi.mock("../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof IpcModule>()),
	getTranscript: h.getTranscript,
	localRowsGet: h.localRowsGet,
}));

import { emptySessionLive, pruneRemovedSessions, useLive } from "./live";
import { prepareSideChatFirstPrompt, refreshTranscriptCache } from "./transcript";
import { useSessions } from "./sessions";

// The desktop targets ES2021, which does not expose Promise.withResolvers.
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

const item = (id: string, text = id): TranscriptItem => ({
	id, parentId: null, ts: "2026-01-01T00:00:00Z", kind: "user", text,
	thinking: null, toolCalls: [], toolResult: null, usage: null, model: null, stopReason: null, hidden: false,
});
const page = (sid: string, items: TranscriptItem[], nextOffset = 10): TranscriptPage => ({
	sessionId: sid, items, nextOffset, tailId: items[items.length - 1]?.id ?? null, reset: false,
});

beforeEach(() => {
	h.getTranscript.mockReset();
	h.localRowsGet.mockReset();
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} });
});

describe("transcript cache read ordering", () => {
	it("keeps the newest full read when an older incremental response arrives later", async () => {
		useLive.getState().setItems("ordering", [item("old")], 10, "old");
		const stale = deferred<TranscriptPage>();
		const fresh = deferred<TranscriptPage>();
		h.getTranscript.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
		const first = refreshTranscriptCache("ordering", true);
		const second = refreshTranscriptCache("ordering");
		fresh.resolve(page("ordering", [item("new")], 20));
		expect(await second).toBe(true);
		stale.resolve(page("ordering", [item("stale")], 15));
		expect(await first).toBe(false);
		expect(useLive.getState().sessions.ordering.items.map((entry) => entry.id)).toEqual(["new"]);
	});

	it("does not recreate a removed session after an in-flight history read resolves", async () => {
		const pending = deferred<TranscriptPage>();
		h.getTranscript.mockReturnValueOnce(pending.promise);
		const read = refreshTranscriptCache("deleted");
		pruneRemovedSessions(["deleted"]);
		pending.resolve(page("deleted", [item("resurrected")]));
		expect(await read).toBe(false);
		expect(useLive.getState().sessions.deleted).toBeUndefined();
	});

	it("a new read after removal cannot share the old read's identity", async () => {
		const old = deferred<TranscriptPage>();
		const current = deferred<TranscriptPage>();
		h.getTranscript.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const beforeRemoval = refreshTranscriptCache("readded");
		pruneRemovedSessions(["readded"]);
		const afterRemoval = refreshTranscriptCache("readded");
		old.resolve(page("readded", [item("old-incarnation")]));
		expect(await beforeRemoval).toBe(false);
		expect(useLive.getState().sessions.readded).toBeUndefined();
		current.resolve(page("readded", [item("current-incarnation")]));
		expect(await afterRemoval).toBe(true);
		expect(useLive.getState().sessions.readded.items.map((entry) => entry.id)).toEqual(["current-incarnation"]);
	});

	it("reads for another session do not supersede or leak into this session", async () => {
		const a = deferred<TranscriptPage>();
		const b = deferred<TranscriptPage>();
		h.getTranscript.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		const first = refreshTranscriptCache("session-a");
		const second = refreshTranscriptCache("session-b");
		b.resolve(page("session-b", [item("b")]));
		a.resolve(page("session-a", [item("a")]));
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		expect(useLive.getState().sessions["session-a"].items.map((entry) => entry.id)).toEqual(["a"]);
		expect(useLive.getState().sessions["session-b"].items.map((entry) => entry.id)).toEqual(["b"]);
	});

	it("honors a rewritten incremental page as replacement rather than resurrecting the old branch", async () => {
		useLive.getState().setItems("rewrite", [item("abandoned")], 10, "abandoned");
		h.getTranscript.mockResolvedValueOnce({ ...page("rewrite", [item("new-branch")], 5), reset: true });
		await refreshTranscriptCache("rewrite", true);
		expect(h.getTranscript).toHaveBeenCalledWith("rewrite", 10, "abandoned");
		expect(useLive.getState().sessions.rewrite.items.map((entry) => entry.id)).toEqual(["new-branch"]);
	});
});

describe("side-chat echo confirmation boundary", () => {
	it.each(["full", "incremental"])("hidden inherited rows never consume the first echo on %s load", (mode) => {
		const sid = `side-${mode}`;
		useSessions.setState({ sessions: { [sid]: { id: sid, kind: "side" } as never } });
		useLive.getState().addUserEcho(sid, "continue");
		const commit = mode === "full" ? useLive.getState().setItems : useLive.getState().appendItems;
		commit(sid, [item("parent", "please continue")], 10, "parent");
		expect(useLive.getState().sessions[sid].pendingUserEchoes.map((echo) => echo.text)).toEqual(["continue"]);
		const boundary = item("side-input", "Side chat forked from main session\n\n## User question\ncontinue");
		commit(sid, mode === "full" ? [item("parent", "please continue"), boundary] : [boundary], 20, boundary.id);
		expect(useLive.getState().sessions[sid].pendingUserEchoes).toEqual([]);
	});

	it("a later incremental user row is confirmed using the boundary on an earlier page", () => {
		const sid = "side-page-boundary";
		useSessions.setState({ sessions: { [sid]: { id: sid, kind: "side" } as never } });
		useLive.getState().setItems(sid, [item("boundary", "Side chat forked from main session\n\n## User question\nfirst")], 10);
		useLive.getState().addUserEcho(sid, "second");
		useLive.getState().appendItems(sid, [item("follow-up", "second")], 20);
		expect(useLive.getState().sessions[sid].pendingUserEchoes).toEqual([]);
	});
});

describe("local rows read lifecycle", () => {
	it("late local rows cannot recreate a deleted session", async () => {
		const pending = deferred<unknown[]>();
		h.localRowsGet.mockReturnValueOnce(pending.promise);
		useLive.getState().hydrateLocalRows("deleted-local-rows");
		await vi.waitFor(() => expect(h.localRowsGet).toHaveBeenCalledWith("deleted-local-rows"));
		pruneRemovedSessions(["deleted-local-rows"]);
		pending.resolve([{ t: "output", ts: 1, anchorId: null, kind: "app", text: "stale card" }]);
		await pending.promise;
		await Promise.resolve();
		expect(useLive.getState().sessions["deleted-local-rows"]).toBeUndefined();
	});

	it("reopening after removal ignores the old local-row hydration", async () => {
		const old = deferred<unknown[]>();
		const current = deferred<unknown[]>();
		h.localRowsGet.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		useLive.getState().hydrateLocalRows("readded-local-rows");
		await vi.waitFor(() => expect(h.localRowsGet).toHaveBeenCalledTimes(1));
		pruneRemovedSessions(["readded-local-rows"]);
		useLive.setState({ sessions: { "readded-local-rows": emptySessionLive() } });
		useLive.getState().hydrateLocalRows("readded-local-rows");
		await vi.waitFor(() => expect(h.localRowsGet).toHaveBeenCalledTimes(2));
		old.resolve([{ t: "output", ts: 1, anchorId: null, kind: "app", text: "stale" }]);
		current.resolve([{ t: "output", ts: 2, anchorId: null, kind: "app", text: "current" }]);
		await vi.waitFor(() => expect(useLive.getState().sessions["readded-local-rows"].commandOutputs.map((entry) => entry.text)).toEqual(["current"]));
	});
});

describe("authoritative first side-chat prompt preparation", () => {
	it("excludes a nested parent's old boundary until the child's own boundary is persisted", async () => {
		const sid = "nested-authoritative";
		const parentBoundary = item("parent-marker", "Side chat forked from main session\n\n## User question\ncontinue");
		const oldUser = item("parent-user", "continue");
		h.getTranscript.mockResolvedValueOnce(page(sid, [parentBoundary, oldUser]));
		await prepareSideChatFirstPrompt(sid);
		expect(h.getTranscript).toHaveBeenCalledWith(sid, undefined, undefined);
		expect(useLive.getState().sessions[sid].sideChatInheritedIds).toEqual([parentBoundary.id, oldUser.id]);
		useLive.getState().addUserEcho(sid, "continue");
		// Neither an inherited marker nor its later copy is evidence of this input.
		useLive.getState().setItems(sid, [parentBoundary, oldUser], 10);
		expect(useLive.getState().sessions[sid].pendingUserEchoes).toHaveLength(1);
		expect(useLive.getState().sessions[sid].sideChatInheritedIds).toBeDefined();
		// Live delivery happens before persistence and must not expose the parent's side chat.
		useLive.getState().reduceFrame({ sessionId: sid, frame: { type: "message_start", messageId: "new-input", message: { role: "user", content: "continue" } } });
		useLive.getState().setItems(sid, [parentBoundary, oldUser], 10);
		expect(useLive.getState().sessions[sid].sideChatInheritedIds).toBeDefined();
		const ownBoundary = item("child-marker", parentBoundary.text!);
		useLive.getState().appendItems(sid, [ownBoundary], 20);
		expect(useLive.getState().sessions[sid].sideChatInheritedIds).toBeUndefined();
		expect(useLive.getState().sessions[sid].pendingUserEchoes).toEqual([]);
	});

	it("a failed first-question retry retains its original authoritative boundary", async () => {
		const sid = "baseline-retry";
		h.getTranscript.mockResolvedValueOnce(page(sid, [item("inherited")]));
		await prepareSideChatFirstPrompt(sid);
		const echo = useLive.getState().addUserEcho(sid, "question");
		useLive.getState().removeUserEcho(sid, echo!);
		await prepareSideChatFirstPrompt(sid);
		expect(h.getTranscript).toHaveBeenCalledTimes(1);
		expect(useLive.getState().sessions[sid].sideChatInheritedIds).toEqual(["inherited"]);
	});

	it("invalid or failed baseline reads throw before marking any inherited history", async () => {
		h.getTranscript.mockResolvedValueOnce({ items: [], nextOffset: undefined });
		await expect(prepareSideChatFirstPrompt("invalid-baseline")).rejects.toThrow("Invalid side-chat transcript baseline");
		expect(useLive.getState().sessions["invalid-baseline"]).toBeUndefined();
		h.getTranscript.mockRejectedValueOnce(new Error("disk read failed"));
		await expect(prepareSideChatFirstPrompt("invalid-baseline")).rejects.toThrow("disk read failed");
		expect(useLive.getState().sessions["invalid-baseline"]).toBeUndefined();
	});
});
