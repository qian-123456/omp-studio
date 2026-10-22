import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem } from "../../lib/contracts";

const backlogUpdate = vi.fn(async () => ({}));
vi.mock("../../lib/ipc", () => ({ backlogUpdate: (...a: unknown[]) => (backlogUpdate as (...x: unknown[]) => unknown)(...a) }));
const load = vi.fn(async () => {});
vi.mock("./backlogStore", () => ({ useBacklog: { getState: () => ({ load }) } }));

import { useComposer } from "../../stores/composer";
import { emitPromptSend } from "../../stores/promptSendEvents";
import { fillIdeasIntoComposer, resetPendingFills } from "./fillComposer";

const item = (id: string, text: string): BacklogItem =>
	({ id, text, kind: "idea", status: "inbox", refs: [], deletedAt: null }) as unknown as BacklogItem;

const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("fillIdeasIntoComposer", () => {
	beforeEach(() => {
		resetPendingFills();
		backlogUpdate.mockClear();
		load.mockClear();
		useComposer.getState().clearDraft("s1");
	});

	it("fills the draft without changing status", async () => {
		fillIdeasIntoComposer("s1", [item("a", "加个暗色模式")]);
		await flush();
		expect(useComposer.getState().drafts["s1"]).toContain("加个暗色模式");
		expect(backlogUpdate).not.toHaveBeenCalled();
	});

	it("marks dispatched after a successful send containing the body", async () => {
		fillIdeasIntoComposer("s1", [item("a", "加个暗色模式")]);
		const sent = useComposer.getState().drafts["s1"];
		emitPromptSend("echoed", "s1", sent);
		// The composer clears its draft on echo, before the RPC succeeds.
		useComposer.getState().clearDraft("s1");
		emitPromptSend("sent", "s1", sent);
		await flush();
		expect(backlogUpdate).toHaveBeenCalledWith("a", { status: "dispatched", targetSessionId: "s1" });
		expect(load).toHaveBeenCalled();
	});

	it("ignores a send from another session or without the body", async () => {
		fillIdeasIntoComposer("s1", [item("a", "加个暗色模式")]);
		emitPromptSend("echoed", "s2", "加个暗色模式");
		emitPromptSend("sent", "s2", "加个暗色模式");
		emitPromptSend("echoed", "s1", "别的内容");
		emitPromptSend("sent", "s1", "别的内容");
		await flush();
		expect(backlogUpdate).not.toHaveBeenCalled();
	});

	it("stays inbox when the draft is cleared without sending", async () => {
		fillIdeasIntoComposer("s1", [item("a", "加个暗色模式")]);
		useComposer.getState().clearDraft("s1");
		emitPromptSend("echoed", "s1", "加个暗色模式");
		emitPromptSend("sent", "s1", "加个暗色模式");
		await flush();
		expect(backlogUpdate).not.toHaveBeenCalled();
	});

	it("keeps tracking after a failed send restores the draft, then dispatches on retry", async () => {
		fillIdeasIntoComposer("s1", [item("a", "加个暗色模式")]);
		const sent = useComposer.getState().drafts["s1"];
		emitPromptSend("echoed", "s1", sent);
		useComposer.getState().clearDraft("s1");
		emitPromptSend("failed", "s1", sent);
		useComposer.getState().setDraft("s1", sent);
		emitPromptSend("echoed", "s1", sent);
		emitPromptSend("sent", "s1", sent);
		await flush();
		expect(backlogUpdate).toHaveBeenCalledWith("a", { status: "dispatched", targetSessionId: "s1" });
	});
});
