import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import type * as Ipc from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

const forkSession = vi.fn();
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	forkSession: (...a: unknown[]) => forkSession(...a),
}));

import {
	closeForkDraft,
	cutItemsAtEntry,
	forkAndSend,
	isForkDraftId,
	openForkDraft,
	sendFromForkDraft,
	startFork,
	useForkDraft,
} from "./forkDraft";

const item = (id: string) => ({ id }) as TranscriptItem;

beforeEach(() => {
	forkSession.mockReset();
	closeForkDraft();
	useUi.setState({ selectedSessionId: null, centerView: "home" });
	useSessions.setState({ sessions: {}, load: vi.fn(async () => {}) });
	useLive.setState({ sessions: {} });
});

describe("cutItemsAtEntry", () => {
	it("cuts inclusively at the pinned entry, shows all otherwise", () => {
		const items = [item("a"), item("b"), item("c")];
		expect(cutItemsAtEntry(items, "b").map((i) => i.id)).toEqual(["a", "b"]);
		expect(cutItemsAtEntry(items, null)).toHaveLength(3);
		expect(cutItemsAtEntry(items, "zzz")).toHaveLength(3);
	});
});

describe("draft state", () => {
	it("opens in the session pane with nothing selected and creates nothing", () => {
		const id = openForkDraft("p1", "e1");
		expect(isForkDraftId(id)).toBe(true);
		expect(useForkDraft.getState().draft).toMatchObject({ id, parentId: "p1", entryId: "e1", sending: false });
		expect(useUi.getState().selectedSessionId).toBeNull();
		expect(useUi.getState().centerView).toBe("session");
		expect(forkSession).not.toHaveBeenCalled();
	});

	it("closes when another session is selected", () => {
		openForkDraft("p1");
		useUi.getState().selectSession("other");
		expect(useForkDraft.getState().draft).toBeNull();
	});
});

describe("startFork decision", () => {
	it("working parent opens the lazy draft without forking", async () => {
		useLive.setState({ sessions: { p1: { streaming: true } as never } });
		await startFork("p1", "e1");
		expect(forkSession).not.toHaveBeenCalled();
		expect(useForkDraft.getState().draft?.entryId).toBe("e1");
	});

	it("idle parent forks immediately and selects the new session", async () => {
		forkSession.mockResolvedValue({ sessionId: "new1" });
		await startFork("p1", "e1");
		expect(forkSession).toHaveBeenCalledWith("p1", "e1");
		expect(useForkDraft.getState().draft).toBeNull();
		expect(useUi.getState().selectedSessionId).toBe("new1");
	});
});

describe("first send from a draft", () => {
	it("forks at send time, swaps to the new session and sends only the typed text", async () => {
		forkSession.mockResolvedValue({ sessionId: "new1" });
		const id = openForkDraft("p1");
		const send = vi.fn(async () => {});
		const onEchoed = vi.fn();
		await sendFromForkDraft(id, "hello", { onEchoed }, send);
		expect(onEchoed).toHaveBeenCalled();
		expect(forkSession).toHaveBeenCalledWith("p1", undefined);
		expect(send).toHaveBeenCalledWith("new1");
		expect(useUi.getState().selectedSessionId).toBe("new1");
		expect(useForkDraft.getState().draft).toBeNull();
		expect(useComposer.getState().drafts["new1"] ?? "").toBe("");
	});

	it("keeps the draft and drops the echo when the fork fails", async () => {
		forkSession.mockRejectedValue(new Error("boom"));
		const id = openForkDraft("p1");
		const send = vi.fn();
		await expect(sendFromForkDraft(id, "hello", {}, send)).rejects.toThrow("boom");
		expect(send).not.toHaveBeenCalled();
		expect(useForkDraft.getState().draft).toMatchObject({ id, sending: false });
		expect(useLive.getState().sessions[id]?.pendingUserEchoes ?? []).toHaveLength(0);
	});

	it("/fork text: failure returns to the parent", async () => {
		forkSession.mockRejectedValue(new Error("nope"));
		await expect(forkAndSend("p1", "hi", vi.fn())).rejects.toThrow("nope");
		expect(useForkDraft.getState().draft).toBeNull();
		expect(useUi.getState().selectedSessionId).toBe("p1");
	});
});
