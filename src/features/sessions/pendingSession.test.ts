import { beforeEach, describe, expect, it } from "vitest";
import { useComposer } from "../../stores/composer";
import { isBlankLocalDraft, isLocalDraftId, usePendingSession } from "./pendingSession";

beforeEach(() => {
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {}, planModes: {} });
});

describe("usePendingSession.open", () => {
	it("creates a local draft without any session id", () => {
		const id = usePendingSession.getState().open({ cwd: "/repo" });
		expect(isLocalDraftId(id)).toBe(true);
		expect(usePendingSession.getState().drafts[id].sessionId).toBeNull();
		expect(usePendingSession.getState().selectedId).toBe(id);
	});

	it("reuses a blank draft with the same cwd, mode and group", () => {
		const a = usePendingSession.getState().open({ cwd: "/repo", mode: "code" });
		const b = usePendingSession.getState().open({ cwd: "/repo", mode: "code", groupId: null });
		expect(b).toBe(a);
		expect(Object.keys(usePendingSession.getState().drafts)).toHaveLength(1);
	});

	it("does not reuse across cwd, mode or group", () => {
		const a = usePendingSession.getState().open({ cwd: "/repo" });
		const ids = new Set([
			a,
			usePendingSession.getState().open({ cwd: "/other" }),
			usePendingSession.getState().open({ cwd: "/repo", mode: "chat" }),
			usePendingSession.getState().open({ cwd: "/repo", groupId: "g1" }),
		]);
		expect(ids.size).toBe(4);
	});

	it("does not reuse a draft that holds input", () => {
		const a = usePendingSession.getState().open({ cwd: "/repo" });
		useComposer.getState().setDraft(a, "half-written prompt");
		const b = usePendingSession.getState().open({ cwd: "/repo" });
		expect(b).not.toBe(a);
		expect(usePendingSession.getState().drafts[a]).toBeDefined();
	});
});

describe("isBlankLocalDraft", () => {
	it("treats whitespace as blank but a chosen model or thinking level as input", () => {
		const id = usePendingSession.getState().open({ cwd: "/repo" });
		useComposer.getState().setDraft(id, "  \n ");
		expect(isBlankLocalDraft(usePendingSession.getState().drafts[id])).toBe(true);
		usePendingSession.getState().update(id, { thinking: "high" });
		expect(isBlankLocalDraft(usePendingSession.getState().drafts[id])).toBe(false);
		usePendingSession.getState().update(id, { thinking: null, model: "p/m" });
		expect(isBlankLocalDraft(usePendingSession.getState().drafts[id])).toBe(false);
	});
});
