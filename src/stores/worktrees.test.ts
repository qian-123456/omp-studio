import { describe, expect, it, vi } from "vitest";
import { WorkspaceRefreshRunner } from "./worktrees";
import type { WorktreeInfo } from "../lib/contracts";

vi.mock("../lib/ipc", () => ({
	gitListWorktrees: vi.fn(),
}));

import { gitListWorktrees } from "../lib/ipc";
function createResolver<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("WorkspaceRefreshRunner (C13)", () => {
	it("re-checks queued requests after trailing fetch finishes and resolves all awaiting promises", async () => {
		const runner = new WorkspaceRefreshRunner();
		const mockGit = vi.mocked(gitListWorktrees);

		const gate1 = createResolver<WorktreeInfo[]>();
		const gate2 = createResolver<WorktreeInfo[]>();

		let call = 0;
		mockGit.mockImplementation(async () => {
			call++;
			if (call === 1) return gate1.promise;
			return gate2.promise;
		});

		const onResult = vi.fn();

		// Call 1 starts
		const p1 = runner.request("ws-1", "/path-1", onResult);
		// Call 2 arrives during Call 1
		const p2 = runner.request("ws-1", "/path-2", onResult);

		// Resolve Call 1 -> triggers trailing fetch
		const list1: WorktreeInfo[] = [
			{ path: "/path-1", branch: "b1", head: "h1", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];
		gate1.resolve(list1);

		// During the trailing fetch, Call 3 arrives
		const p3 = runner.request("ws-1", "/path-3", onResult);

		// Resolve Call 2
		const list2: WorktreeInfo[] = [
			{ path: "/path-2", branch: "b2", head: "h2", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];
		gate2.resolve(list2);

		const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

		expect(res1).toEqual(list1);
		expect(res2).toEqual(list2);
		expect(res3).toEqual(list2);
	});
});
