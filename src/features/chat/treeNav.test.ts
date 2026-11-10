// @vitest-environment jsdom
/** Tree navigation actions: edit readiness, recovery and branch preservation. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	treeNavigate: vi.fn(), rpcSend: vi.fn(), getTranscript: vi.fn(), ensureLive: vi.fn(),
	toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../lib/ipc", () => ({ treeNavigate: h.treeNavigate, rpcSend: h.rpcSend, getTranscript: h.getTranscript }));
vi.mock("../../lib/ensureLive", () => ({ ensureLive: h.ensureLive, isResumeCancelled: (e: unknown) => e === "resume cancelled" }));
vi.mock("../../lib/toast", () => ({ toast: h.toast }));
vi.mock("../sessions/forkDraft", () => ({ isForkDraftId: (id: string) => id.startsWith("fork-draft:") }));

import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";
import { navigateTree, startTreeResend, treeUnavailable, useTreeEditPending } from "./treeNav";

const SID = "s1";
// The supported ES2021 target does not provide Promise.withResolvers.
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => { resolve = res; });
	return { promise, resolve };
}

beforeEach(() => {
	vi.resetAllMocks();
	h.getTranscript.mockResolvedValue({ sessionId: SID, items: [], nextOffset: 0, reset: true, tailId: null });
	h.rpcSend.mockResolvedValue({ data: { entries: [], leafId: "root" } });
	h.treeNavigate.mockResolvedValue({ cancelled: false, editorText: "original text" });
	h.ensureLive.mockImplementation(async () => useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } }));
	useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
	useSessions.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
	useTreeEditPending.setState({ entries: {} });
	useComposer.setState({ drafts: {} });
});
afterEach(() => {
	useLive.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
	useTreeEditPending.setState({ entries: {} });
});

describe("treeUnavailable", () => {
	it("allows suspended sessions but refuses streaming and fork drafts", () => {
		expect(treeUnavailable(SID)).toBe(false);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		expect(treeUnavailable(SID)).toBe(true);
		useLive.setState({ sessions: { [SID]: emptySessionLive() } });
		expect(treeUnavailable(SID)).toBe(false);
		expect(treeUnavailable("fork-draft:x")).toBe(true);
	});

	it("refuses an outstanding dialog even before catalog status catches up", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, pendingUi: [{ request: { id: "approval" } }] as never } } });
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(false);
		expect(h.treeNavigate).not.toHaveBeenCalled();
		expect(h.ensureLive).not.toHaveBeenCalled();
	});

	it.each(["working", "awaiting_approval", "awaiting_answer"])("refuses catalog status %s", (status) => {
		useSessions.setState({ sessions: { [SID]: { status } as never } });
		expect(treeUnavailable(SID)).toBe(true);
	});
});

describe("startTreeResend", () => {
	it("hands text to the composer, releases pending, then synchronizes the leaf", async () => {
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(true);
		expect(h.treeNavigate).toHaveBeenCalledWith(SID, "u1");
		expect(h.ensureLive).not.toHaveBeenCalled();
		expect(useTree.getState().resend[SID]).toEqual({ entryId: "u1", prevLeafId: "root" });
		expect(useComposer.getState().drafts[SID]).toBe("original text");
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
		await vi.waitFor(() => expect(useTree.getState().leaf[SID]).toBe("root"));
		expect(h.rpcSend).toHaveBeenCalledWith(SID, { type: "get_entries" });
	});

	it("uses the transcript text when upstream sends no editorText", async () => {
		h.treeNavigate.mockResolvedValue({ cancelled: false });
		await startTreeResend(SID, "u1", "from item");
		expect(useComposer.getState().drafts[SID]).toBe("from item");
	});

	it.each(["transcript", "leaf"])("does not hold the composer disabled for an unresolved %s refresh", async (stage) => {
		if (stage === "transcript") h.getTranscript.mockReturnValue(new Promise(() => {}));
		else h.rpcSend.mockResolvedValueOnce({ data: { entries: [], leafId: "root" } }).mockReturnValue(new Promise(() => {}));
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(true);
		expect(useComposer.getState().drafts[SID]).toBe("original text");
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
	});

	it("handles failed background synchronization without losing the editable draft", async () => {
		h.getTranscript.mockRejectedValue(new Error("disk read failed"));
		h.rpcSend.mockResolvedValueOnce({ data: { entries: [], leafId: "root" } }).mockRejectedValue(new Error("RPC disconnected"));
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(true);
		expect(useComposer.getState().drafts[SID]).toBe("original text");
		await vi.waitFor(() => expect(h.rpcSend).toHaveBeenCalledTimes(2));
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
	});

	it("wakes a suspended session without selecting a model or sending a prompt", async () => {
		useLive.setState({ sessions: { [SID]: emptySessionLive() } });
		const resume = deferred<void>();
		h.ensureLive.mockReturnValue(resume.promise);
		const edit = startTreeResend(SID, "u1", "fallback");
		expect(h.ensureLive).toHaveBeenCalledWith(SID);
		expect(h.treeNavigate).not.toHaveBeenCalled();
		expect(useTreeEditPending.getState().entries[SID]).toBe("u1");
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
		resume.resolve();
		expect(await edit).toBe(true);
		expect(h.treeNavigate).toHaveBeenCalledWith(SID, "u1");
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
	});

	it.each(["spawn failed", "resume cancelled"])("releases pending after recovery %s without navigating or changing the draft", async (error) => {
		useLive.setState({ sessions: { [SID]: emptySessionLive() } });
		useComposer.getState().setDraft(SID, "unsent draft");
		h.ensureLive.mockRejectedValue(error);
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(false);
		expect(h.treeNavigate).not.toHaveBeenCalled();
		expect(useComposer.getState().drafts[SID]).toBe("unsent draft");
		expect(useTree.getState().resend[SID]).toBeUndefined();
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
		expect(h.toast.error).toHaveBeenCalledTimes(error === "resume cancelled" ? 0 : 1);
	});

	it("does not move the branch when the pre-edit canonical snapshot fails", async () => {
		useTree.getState().setLeaf(SID, null);
		useComposer.getState().setDraft(SID, "unsent draft");
		h.rpcSend.mockRejectedValue(new Error("snapshot unavailable"));
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(false);
		expect(h.treeNavigate).not.toHaveBeenCalled();
		expect(useComposer.getState().drafts[SID]).toBe("unsent draft");
		expect(useTree.getState().resend[SID]).toBeUndefined();
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
		expect(h.toast.error).toHaveBeenCalledOnce();
	});

	it.each([{ cancelled: true }, { cancelled: false, aborted: true }])("preserves the old branch and draft after upstream refusal %j", async (result) => {
		useTree.getState().setLeaf(SID, "answer-1");
		useComposer.getState().setDraft(SID, "unsent draft");
		h.treeNavigate.mockResolvedValue(result);
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(false);
		expect(useTree.getState().leaf[SID]).toBe("answer-1");
		expect(useTree.getState().resend[SID]).toBeUndefined();
		expect(useComposer.getState().drafts[SID]).toBe("unsent draft");
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
		expect(h.getTranscript).not.toHaveBeenCalled();
	});

	it("releases pending and preserves the old message after a failed navigation", async () => {
		const items = [{ id: "u1", text: "original text" }] as never;
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, items } } });
		useComposer.getState().setDraft(SID, "unsent draft");
		h.treeNavigate.mockRejectedValue(new Error("entry missing"));
		expect(await startTreeResend(SID, "u1", "fallback")).toBe(false);
		expect(useLive.getState().sessions[SID].items).toBe(items);
		expect(useComposer.getState().drafts[SID]).toBe("unsent draft");
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
	});

	it("does not start a second edit while navigation is pending", async () => {
		const navigation = deferred<{ cancelled: boolean; editorText: string }>();
		h.treeNavigate.mockReturnValueOnce(navigation.promise);
		const first = startTreeResend(SID, "u1", "first");
		expect(await startTreeResend(SID, "u2", "second")).toBe(false);
		await vi.waitFor(() => expect(h.treeNavigate).toHaveBeenCalledOnce());
		navigation.resolve({ cancelled: false, editorText: "first" });
		expect(await first).toBe(true);
		expect(useComposer.getState().drafts[SID]).toBe("first");
	});
});

describe("navigateTree", () => {
	it("switches versions and refetches the canonical flat snapshot", async () => {
		h.treeNavigate.mockResolvedValue({ cancelled: false });
		h.rpcSend.mockResolvedValue({ data: { entries: [], leafId: "a2" } });
		expect(await navigateTree(SID, "a2")).toEqual({ cancelled: false });
		expect(useTree.getState().leaf[SID]).toBe("a2");
	});

	it("maps TREE_BUSY to a friendly toast without refetching", async () => {
		h.treeNavigate.mockRejectedValue("TREE_BUSY");
		expect(await navigateTree(SID, "a2")).toBeNull();
		expect(h.toast.info).toHaveBeenCalledOnce();
		expect(h.toast.error).not.toHaveBeenCalled();
		expect(h.getTranscript).not.toHaveBeenCalled();
	});
});

describe("flat tree snapshot", () => {
	it("reads a long parent chain without requesting a recursively nested tree", async () => {
		const entries = Array.from({ length: 600 }, (_, index) => ({
			id: `entry-${index}`, parentId: index === 0 ? null : `entry-${index - 1}`,
		}));
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, items: entries as never } } });
		h.rpcSend.mockResolvedValue({ data: { entries, leafId: "entry-599" } });
		await useTree.getState().refreshLeaf(SID);
		expect(h.rpcSend).toHaveBeenCalledWith(SID, { type: "get_entries" });
		expect(h.rpcSend).toHaveBeenCalledOnce();
		expect(useTree.getState().leaf[SID]).toBe("entry-599");
	});

	it("does not apply a snapshot that cannot account for the current transcript", async () => {
		useLive.setState({ sessions: { [SID]: {
			...emptySessionLive(), alive: true, items: [{ id: "newer-entry" }] as never,
		} } });
		h.rpcSend.mockResolvedValue({ data: { entries: [{ id: "older-entry" }], leafId: "older-entry" } });
		await useTree.getState().refreshLeaf(SID);
		expect(useTree.getState().leaf[SID]).toBeNull();
	});
});
