// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnCheckpoint } from "../../lib/contracts";
import { tNow } from "../../stores/language";

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), undo: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: mocks.confirm, copyText: vi.fn(), errMsg: String }));
vi.mock("../../lib/ipc", () => ({ gitUndoTurn: mocks.undo }));
vi.mock("../../lib/toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("../../stores/turnNav", () => ({ useTurnNav: { getState: () => ({ showCommit: vi.fn() }) } }));
vi.mock("../../stores/ui", () => ({ useUi: { getState: () => ({ openModal: vi.fn() }) } }));
vi.mock("../sessions/forkDraft", () => ({ startFork: vi.fn() }));

import { AnswerFooter } from "./AnswerFooter";

function turn(id: string): TurnCheckpoint {
	return { turnId: id, sessionId: "s", userItemId: "u", prompt: "edit", before: "b", after: "a",
		headBefore: null, headAfter: null, commits: [], files: [{ path: "file.txt", status: "M" }],
		endedAt: "2026-10-29T00:00:00Z", restorable: true, undone: false };
}

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

function mount(turns: TurnCheckpoint[]) {
	render(<AnswerFooter sessionId="s" cwd="/repo" sessionFile="/sessions/s.jsonl" turnCheckpoint={turns[0]} turns={turns} compact />);
	fireEvent.click(screen.getByRole("button", { name: tNow("chat.undo.btnAria") }));
}

describe("checkpoint undo consent", () => {
	it.each([1, 2])("discloses own edits recorded during %i turns and preserves everything on cancel", async (count) => {
		mocks.confirm.mockResolvedValue(false);
		mount(Array.from({ length: count }, (_, i) => turn(`t${i + 1}`)));
		await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
		const message = mocks.confirm.mock.calls[0][0] as string;
		expect(message).toContain("你自己编辑的内容");
		expect(message).toContain("无法区分改动来源");
		expect(mocks.undo).not.toHaveBeenCalled();
	});

	it("never forces past post-turn user edits without a separate confirmation", async () => {
		mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		mocks.undo.mockResolvedValue({ conflicts: ["user.txt"], restored: [], deleted: [], turnsUndone: 0, headReset: false, warning: null });
		mount([turn("t1")]);
		await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
		expect(mocks.confirm.mock.calls[1][0]).toContain("user.txt");
		expect(mocks.undo).toHaveBeenCalledExactlyOnceWith("/repo", "/sessions/s.jsonl", "t1", false);
		expect(mocks.success).not.toHaveBeenCalled();
	});

	it("sends a force override only after the user accepts the conflict warning", async () => {
		mocks.confirm.mockResolvedValue(true);
		mocks.undo.mockResolvedValueOnce({ conflicts: ["user.txt"], restored: [], deleted: [], turnsUndone: 0, headReset: false, warning: null });
		mocks.undo.mockResolvedValueOnce({ conflicts: [], restored: ["file.txt"], deleted: [], turnsUndone: 1, headReset: false, warning: null });
		mount([turn("t1")]);
		await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
		expect(mocks.confirm).toHaveBeenCalledTimes(2);
		expect(mocks.undo.mock.calls.map((call) => call[3])).toEqual([false, true]);
	});
});
