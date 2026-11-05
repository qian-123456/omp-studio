// @vitest-environment jsdom
/** Tree navigation actions: busy refusal without state changes, edit-&-resend
 * fill (editorText back into the composer) and version switching refetch. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	treeNavigate: vi.fn(),
	treeGet: vi.fn(),
	getTranscript: vi.fn(),
	toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("../../lib/ipc", () => ({
	treeNavigate: h.treeNavigate,
	treeGet: h.treeGet,
	getTranscript: h.getTranscript,
}));
vi.mock("../../lib/toast", () => ({ toast: h.toast }));
vi.mock("../sessions/forkDraft", () => ({ isForkDraftId: (id: string) => id.startsWith("fork-draft:") }));

import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";
import { navigateTree, startTreeResend, treeUnavailable } from "./treeNav";

const SID = "s1";

beforeEach(() => {
	vi.resetAllMocks();
	useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: false } } });
	useSessions.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
	useComposer.setState({ drafts: {} });
});
afterEach(() => {
	useLive.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
});

describe("treeUnavailable", () => {
	it("is true for streaming, awaiting and non-live sessions", () => {
		expect(treeUnavailable(SID)).toBe(false);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		expect(treeUnavailable(SID)).toBe(true);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: false, streaming: false } } });
		expect(treeUnavailable(SID)).toBe(true);
		expect(treeUnavailable("fork-draft:x")).toBe(true);
	});

	it("is true while the session waits on a dialog", () => {
		useSessions.setState({
			sessions: {
				[SID]: {
					id: SID, tool: "omp", file: "", cwd: "", title: "", label: "",
					createdAt: "", updatedAt: "", forkDepth: 0, status: "awaiting_approval",
					unread: false, live: true, pinned: false, archived: false, mode: "code",
				} as never,
			},
		});
		expect(treeUnavailable(SID)).toBe(true);
	});
});

describe("startTreeResend", () => {
	it("rewinds past the user entry and hands the text to the composer", async () => {
		h.treeNavigate.mockResolvedValue({ cancelled: true, editorText: "original text" });
		h.getTranscript.mockResolvedValue({ sessionId: SID, items: [], nextOffset: 0, reset: true, tailId: null });
		h.treeGet.mockResolvedValue({ tree: [], leafId: "root" });

		const ok = await startTreeResend(SID, "u1", "fallback");
		expect(ok).toBe(true);
		expect(h.treeNavigate).toHaveBeenCalledWith(SID, "u1");
		// Whole transcript refetched, leaf refreshed, banner armed.
		expect(h.getTranscript).toHaveBeenCalledWith(SID);
		expect(useTree.getState().leaf[SID]).toBe("root");
		expect(useTree.getState().resend[SID]).toEqual({ entryId: "u1", prevLeafId: null });
		expect(useComposer.getState().drafts[SID]).toBe("original text");
	});

	it("uses the transcript text when upstream sends no editorText", async () => {
		h.treeNavigate.mockResolvedValue({ cancelled: true });
		h.getTranscript.mockResolvedValue({ sessionId: SID, items: [], nextOffset: 0, reset: true, tailId: null });
		h.treeGet.mockResolvedValue({ tree: [], leafId: null });
		await startTreeResend(SID, "u1", "from item");
		expect(useComposer.getState().drafts[SID]).toBe("from item");
	});

	it("does not start a second edit while the first navigation is pending", async () => {
		// ES2021 does not provide Promise.withResolvers.
		let resolve!: (value: { cancelled: boolean; editorText: string }) => void;
		const promise = new Promise<{ cancelled: boolean; editorText: string }>((done) => { resolve = done; });
		h.treeNavigate.mockReturnValueOnce(promise).mockResolvedValue({ cancelled: true, editorText: "second" });
		h.getTranscript.mockResolvedValue({ sessionId: SID, items: [], nextOffset: 0, tailId: null });
		h.treeGet.mockResolvedValue({ tree: [], leafId: null });
		const first = startTreeResend(SID, "u1", "first");
		const second = await startTreeResend(SID, "u2", "second");
		expect(second).toBe(false);
		expect(h.treeNavigate).toHaveBeenCalledOnce();
		resolve({ cancelled: true, editorText: "first" });
		expect(await first).toBe(true);
		expect(useComposer.getState().drafts[SID]).toBe("first");
	});

	it("refuses while streaming with a toast and changes nothing", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		const ok = await startTreeResend(SID, "u1", "x");
		expect(ok).toBe(false);
		expect(h.treeNavigate).not.toHaveBeenCalled();
		expect(h.toast.info).toHaveBeenCalledOnce();
		expect(useTree.getState().resend[SID]).toBeUndefined();
	});
});

describe("navigateTree", () => {
	it("switches versions: navigates and refetches", async () => {
		h.treeNavigate.mockResolvedValue({ cancelled: false });
		h.getTranscript.mockResolvedValue({ sessionId: SID, items: [], nextOffset: 0, reset: true, tailId: null });
		h.treeGet.mockResolvedValue({ tree: [], leafId: "a2" });
		const data = await navigateTree(SID, "a2");
		expect(data).toEqual({ cancelled: false });
		expect(useTree.getState().leaf[SID]).toBe("a2");
	});

	it("maps TREE_BUSY to the friendly toast without refetching", async () => {
		h.treeNavigate.mockRejectedValue("TREE_BUSY");
		const data = await navigateTree(SID, "a2");
		expect(data).toBeNull();
		expect(h.toast.info).toHaveBeenCalledOnce();
		expect(h.toast.error).not.toHaveBeenCalled();
		expect(h.getTranscript).not.toHaveBeenCalled();
	});
});
