import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInfo } from "../../lib/contracts";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), prompt: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ gitRemoveWorktree: mocks.remove }));
vi.mock("../../lib/dialogs", () => ({ mountPromptDialog: mocks.prompt }));
import { removeWorktreeFlow } from "./removeWorktree";

const wt: WorktreeInfo = { path: "/repo/.worktrees/feature", branch: "feature", head: "abc", dirty: 0, sessionIds: ["idle-session"], ahead: 0, behind: 0 };
const choice = { force: false, deleteBranch: true };

beforeEach(() => { vi.resetAllMocks(); mocks.remove.mockResolvedValue(undefined); });

describe("worktree cleanup ownership modes", () => {
	it("keeps explicitly confirmed idle-session cleanup distinct from orphan reclamation", async () => {
		await expect(removeWorktreeFlow("/repo", wt, choice)).resolves.toBe(true);
		expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("/repo", wt.path, true, false, false);
	});

	it("requests mutation-time orphan ownership revalidation even when force is confirmed", async () => {
		await expect(removeWorktreeFlow("/repo", wt, { force: true, deleteBranch: true }, true)).resolves.toBe(true);
		expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("/repo", wt.path, true, true, true);
	});

	it("does not report partial branch-deletion failure as a successful removal", async () => {
		mocks.remove.mockRejectedValue(new Error("directory removed; branch not merged"));
		await expect(removeWorktreeFlow("/repo", wt, choice, true)).rejects.toThrow("branch not merged");
	});

	it("does not invoke cleanup when confirmation is cancelled", async () => {
		mocks.prompt.mockResolvedValue(null);
		await expect(removeWorktreeFlow("/repo", wt)).resolves.toBe(false);
		expect(mocks.remove).not.toHaveBeenCalled();
	});
});
