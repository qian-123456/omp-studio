import { describe, expect, it } from "vitest";
import type { Workspace } from "../../lib/contracts";
import { terminalScopeForCwd } from "./terminalTarget";

const projects: Workspace[] = [
	{ id: "project", path: "/repo", name: "repo", kind: "project", sort: 0, mode: "code" },
	{ id: "other", path: "/plain", name: "plain", kind: "project", sort: 1, mode: "code" },
];
const roots = ["/repo", "/repo/.worktrees/a", "/repo/.worktrees/b"];

describe("terminal project/worktree scope", () => {
	it("shares a project or worktree scope with its subdirectories", () => {
		expect(terminalScopeForCwd("/repo/src", projects, roots)).toBe("/repo");
		expect(terminalScopeForCwd("/repo/.worktrees/a/src", projects, roots)).toBe("/repo/.worktrees/a");
		expect(terminalScopeForCwd("/plain/sub", projects, null)).toBe("/plain");
	});
	it("keeps sibling worktrees and unrelated directories separate", () => {
		expect(terminalScopeForCwd("/repo/.worktrees/a", projects, roots)).not.toBe(terminalScopeForCwd("/repo/.worktrees/b", projects, roots));
		expect(terminalScopeForCwd("/unassigned", projects, null)).toBe("/unassigned");
	});
});
