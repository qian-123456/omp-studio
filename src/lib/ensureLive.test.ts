import { beforeEach, describe, expect, it, vi } from "vitest";

import { errMsg } from "./dialogs";
import {
	RESUME_MISSING_CWD_MODAL,
	cwdMissingPath,
	ensureLive,
	isResumeCancelled,
	rejectResume,
	resolveResume,
} from "./ensureLive";
import { rpcEnsureLive } from "./ipc";
import { useUi } from "../stores/ui";

vi.mock("./ipc", () => ({
	rpcEnsureLive: vi.fn(),
	gitCreateWorktree: vi.fn(),
	gitListBranches: vi.fn(),
}));

// Keep the real store (pure zustand), but silence the sessions store's Tauri
// imports: only `sessions`/`workspaces` getters are used.
vi.mock("../stores/sessions", () => ({
	useSessions: {
		getState: () => ({ sessions: {}, workspaces: [] }),
	},
}));

const liveInfo = {
	sessionId: "s1",
	sessionFile: "/tmp/s1.jsonl",
	pid: 1,
	cwd: "/tmp",
};

beforeEach(() => {
	vi.mocked(rpcEnsureLive).mockReset();
	useUi.getState().closeModal();
});

describe("ensureLive", () => {
	it("passes through a successful resume", async () => {
		vi.mocked(rpcEnsureLive).mockResolvedValue(liveInfo);
		await expect(ensureLive("s1")).resolves.toEqual(liveInfo);
		expect(useUi.getState().modal).toBeNull();
	});

	it("propagates non-sentinel errors without opening the modal", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValue(new Error("spawn failed"));
		await expect(ensureLive("s1")).rejects.toThrow("spawn failed");
		expect(useUi.getState().modal).toBeNull();
	});

	it("opens the resume-missing-cwd modal on CWD_MISSING:", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValue(
			"CWD_MISSING:/repo/.worktrees/old",
		);
		const p = ensureLive("s1");
		await vi.waitFor(() => {
			expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL);
		});
		const props = useUi.getState().modal!.props;
		expect(props.sessionId).toBe("s1");
		expect(props.cwd).toBe("/repo/.worktrees/old");
		expect(props.repoRoot).toBe("/repo");
		expect(props.worktreeName).toBe("old");

		// Dialog resolves once the user picks a target and it succeeds.
		resolveResume("s1", liveInfo);
		await expect(p).resolves.toEqual(liveInfo);
		expect(useUi.getState().modal).toBeNull();
	});

	it("cancel rejects with an error isResumeCancelled recognizes", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValue(
			"CWD_MISSING:/repo/.worktrees/old",
		);
		const p = ensureLive("s1");
		await vi.waitFor(() => {
			expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL);
		});
		rejectResume("s1");
		await expect(p).rejects.toSatisfy((e) => isResumeCancelled(e));
		await expect(p).rejects.toBeInstanceOf(Error);
	});

	it("worktreeName is absent for non-.worktrees layouts", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValue("CWD_MISSING:/gone/dir");
		const p = ensureLive("s1");
		p.catch(() => {});
		await vi.waitFor(() => {
			expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL);
		});
		const props = useUi.getState().modal!.props;
		expect(props.cwd).toBe("/gone/dir");
		expect(props.worktreeName).toBeUndefined();
		rejectResume("s1");
		await expect(p).rejects.toSatisfy((e) => isResumeCancelled(e));
	});
});

describe("cwdMissingPath", () => {
	it("parses the sentinel prefix", () => {
		expect(cwdMissingPath("CWD_MISSING:/x/y")).toBe("/x/y");
		expect(cwdMissingPath(new Error("CWD_MISSING:/z"))).toBe("/z");
		expect(cwdMissingPath("other error")).toBeNull();
		expect(cwdMissingPath(errMsg(new Error("boom")))).toBeNull();
	});
});
