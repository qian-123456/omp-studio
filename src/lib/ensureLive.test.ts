import { beforeEach, describe, expect, it, vi } from "vitest";

import { errMsg } from "./dialogs";
import {
	RESUME_MISSING_CWD_MODAL,
	RESUME_MISSING_MODEL_MODAL,
	cwdMissingPath,
	ensureLive,
	isResumeCancelled,
	rejectResume,
	resolveResume,
	resumeSession,
	unavailableModelDiagnostic,
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

	it("offers an explicit model choice without retrying a default", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:Could not restore model old/missing");
		const promise = ensureLive("s1");
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL));
		expect(useUi.getState().modal?.props.diagnostic).toBe("Could not restore model old/missing");
		expect(rpcEnsureLive).toHaveBeenCalledTimes(1);
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce(liveInfo);
		await resumeSession("s1", undefined, "available/model");
		await expect(promise).resolves.toEqual(liveInfo);
		expect(rpcEnsureLive).toHaveBeenLastCalledWith("s1", undefined, "available/model");
		expect(useUi.getState().modal).toBeNull();
	});

	it("passes only an explicit picker choice into the first resume", async () => {
		vi.mocked(rpcEnsureLive).mockResolvedValue(liveInfo);
		await expect(ensureLive("s1", "available/model")).resolves.toEqual(liveInfo);
		expect(rpcEnsureLive).toHaveBeenCalledWith("s1", undefined, "available/model");
	});

	it("shares same-session callers instead of cancelling either", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:missing");
		const first = ensureLive("s1");
		const second = ensureLive("s1");
		expect(first).toBe(second);
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL));
		expect(rpcEnsureLive).toHaveBeenCalledTimes(1);
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce(liveInfo);
		await resumeSession("s1", undefined, "p/new");
		await expect(Promise.all([first, second])).resolves.toEqual([liveInfo, liveInfo]);
	});

	it("queues another session without rejecting the active request", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValue("SESSION_MODEL_UNAVAILABLE:missing");
		const first = ensureLive("s1");
		const firstResult = first.catch((err) => err);
		const second = ensureLive("s2");
		await vi.waitFor(() => expect(useUi.getState().modal?.props.sessionId).toBe("s1"));
		rejectResume("s1");
		expect(isResumeCancelled(await firstResult)).toBe(true);
		await vi.waitFor(() => expect(useUi.getState().modal?.props.sessionId).toBe("s2"));
		resolveResume("s2", { ...liveInfo, sessionId: "s2" });
		await expect(second).resolves.toMatchObject({ sessionId: "s2" });
	});

	it("preserves an explicit model through missing-directory recovery", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("CWD_MISSING:/repo/.worktrees/old");
		const promise = ensureLive("s1", "p/new");
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL));
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce(liveInfo);
		await resumeSession("s1", "/repo");
		expect(rpcEnsureLive).toHaveBeenLastCalledWith("s1", "/repo", "p/new");
		await expect(promise).resolves.toEqual(liveInfo);
	});

	it("transitions from location to model recovery without old cleanup cancelling it", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("CWD_MISSING:/repo/.worktrees/old");
		const promise = ensureLive("s1");
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL));
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:missing");
		await resumeSession("s1", "/repo");
		expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL);
		rejectResume("s1", undefined, RESUME_MISSING_CWD_MODAL);
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce(liveInfo);
		await resumeSession("s1", undefined, "p/new");
		expect(rpcEnsureLive).toHaveBeenLastCalledWith("s1", "/repo", "p/new");
		await expect(promise).resolves.toEqual(liveInfo);
	});

	it("transitions from model to location recovery and preserves the model choice", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:missing");
		const promise = ensureLive("s1");
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL));
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("CWD_MISSING:/repo/.worktrees/old");
		await resumeSession("s1", undefined, "p/new");
		expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_CWD_MODAL);
		rejectResume("s1", undefined, RESUME_MISSING_MODEL_MODAL);
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce(liveInfo);
		await resumeSession("s1", "/repo");
		expect(rpcEnsureLive).toHaveBeenLastCalledWith("s1", "/repo", "p/new");
		await expect(promise).resolves.toEqual(liveInfo);
	});

	it("keeps failed retries pending for the dialog's inline error and another choice", async () => {
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:missing");
		const promise = ensureLive("s1");
		const result = promise.catch((err) => err);
		await vi.waitFor(() => expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL));
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce(new Error("permission denied"));
		await expect(resumeSession("s1", undefined, "p/new")).rejects.toThrow("permission denied");
		expect(useUi.getState().modal?.name).toBe(RESUME_MISSING_MODEL_MODAL);
		rejectResume("s1");
		expect(isResumeCancelled(await result)).toBe(true);
	});

	it("parses only the model sentinel, leaving ordinary diagnostics alone", () => {
		expect(unavailableModelDiagnostic(new Error("SESSION_MODEL_UNAVAILABLE: missing"))).toBe("missing");
		expect(unavailableModelDiagnostic("spawn failed")).toBeNull();
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
