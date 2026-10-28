// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInfo } from "../../lib/contracts";

const mocks = vi.hoisted(() => ({
	scan: vi.fn(), root: vi.fn(), remove: vi.fn(), refresh: vi.fn(), confirm: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ gitRepoRoot: mocks.root, gitScanOrphans: mocks.scan }));
vi.mock("../../lib/hooks", () => ({ useHomeDir: () => null }));
vi.mock("./removeWorktree", () => ({ removeWorktreeFlow: mocks.remove }));
vi.mock("../../stores/worktrees", () => ({ useWorktrees: { getState: () => ({ refresh: mocks.refresh }) } }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: mocks.confirm, errMsg: (error: unknown) => String(error) }));

import { useOrphans } from "./OrphanBadge";

const wt: WorktreeInfo = {
	path: "/repo/.worktrees/feature", branch: "omp/feature", head: "abc",
	dirty: 0, sessionIds: [], ahead: 1, behind: 0,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.root.mockResolvedValue("/repo");
	mocks.scan.mockResolvedValue([wt]);
	mocks.refresh.mockResolvedValue(undefined);
	mocks.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe("orphan cleanup disk reconciliation", () => {
	it.each(["single", "batch"] as const)("reconciles a deleted directory after %s branch cleanup fails", async (kind) => {
		const onChanged = vi.fn();
		const { result } = renderHook(() => useOrphans("/repo", onChanged));
		await waitFor(() => expect(result.current.orphans).toHaveLength(1));
		mocks.remove.mockRejectedValue(new Error("worktree removed, branch not merged"));
		mocks.scan.mockResolvedValue([]);
		await act(async () => {
			if (kind === "single") await result.current.reclaim(wt);
			else await result.current.reclaimAll();
		});
		expect(result.current.orphans).toEqual([]);
		expect(result.current.error).toContain("branch not merged");
		expect(mocks.refresh).toHaveBeenCalled();
		expect(onChanged).toHaveBeenCalled();
		expect(mocks.remove.mock.calls[0][3]).toBe(true);
	});

	it("retains a still-present worktree when removal is refused", async () => {
		const { result } = renderHook(() => useOrphans("/repo"));
		await waitFor(() => expect(result.current.orphans).toHaveLength(1));
		mocks.remove.mockRejectedValue(new Error("worktree is in use"));
		await act(async () => { await result.current.reclaim(wt); });
		expect(result.current.orphans).toEqual([wt]);
		expect(result.current.error).toContain("in use");
	});

	it("does not retain an unverified stale card when reconciliation fails", async () => {
		const { result } = renderHook(() => useOrphans("/repo"));
		await waitFor(() => expect(result.current.orphans).toHaveLength(1));
		mocks.remove.mockRejectedValue(new Error("branch cleanup failed"));
		mocks.scan.mockRejectedValue(new Error("cannot rescan"));
		await act(async () => { await result.current.reclaim(wt); });
		expect(result.current.orphans).toEqual([]);
		expect(result.current.error).toContain("branch cleanup failed");
	});
	it("ignores an old repository reconciliation after the hook switches repositories", async () => {
		let finish!: (value: boolean) => void;
		mocks.remove.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
		mocks.root.mockImplementation((cwd: string) => Promise.resolve(cwd));
		const { result, rerender } = renderHook(({ cwd }) => useOrphans(cwd), { initialProps: { cwd: "/repo" } });
		await waitFor(() => expect(result.current.orphans).toHaveLength(1));
		let pending!: Promise<void>;
		act(() => { pending = result.current.reclaim(wt); });
		const other = { ...wt, path: "/other/.worktrees/feature" };
		mocks.scan.mockResolvedValue([other]);
		rerender({ cwd: "/other" });
		await waitFor(() => expect(result.current.orphans).toEqual([other]));
		mocks.scan.mockResolvedValue([wt]);
		await act(async () => { finish(true); await pending; });
		expect(result.current.orphans).toEqual([other]);
		expect(result.current.error).toBeNull();
	});
});
