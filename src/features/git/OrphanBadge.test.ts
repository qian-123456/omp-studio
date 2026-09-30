import { describe, expect, it } from "vitest";
import { OrphanBadge, OrphanBanner } from "./OrphanBadge";
import { repoRootFromWorktree } from "./helpers";

describe("OrphanBadge (Option 3 Compact Idle Alert)", () => {
	it("exports both OrphanBadge and backward-compatible OrphanBanner", () => {
		expect(typeof OrphanBadge).toBe("function");
		expect(typeof OrphanBanner).toBe("function");
		expect(OrphanBadge).toBe(OrphanBanner);
	});

	it("correctly identifies repo roots for orphaned worktrees", () => {
		const repo = "/Users/test/Documents/my-repo";
		const wt1 = "/Users/test/Documents/my-repo/.worktrees/feat-auth";
		const wt2 = "/Users/test/Documents/my-repo/.worktrees/fix-bug";
		const other = "/Users/test/Documents/other-repo/.worktrees/test";

		expect(repoRootFromWorktree(wt1)).toBe(repo);
		expect(repoRootFromWorktree(wt2)).toBe(repo);
		expect(repoRootFromWorktree(other)).toBe("/Users/test/Documents/other-repo");
		expect(repoRootFromWorktree(wt1) === repo).toBe(true);
		expect(repoRootFromWorktree(other) === repo).toBe(false);
	});
});
