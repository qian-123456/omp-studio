import { describe, expect, it, vi } from "vitest";
import { createSession } from "./createSession";
import * as ipc from "./ipc";

vi.mock("./ipc", () => ({
	rpcStart: vi.fn(),
	rpcSend: vi.fn(),
	gitBadge: vi.fn().mockResolvedValue(null),
	gitRepoRoot: vi.fn().mockResolvedValue(null),
}));

describe("createSession", () => {
	it("forwards planYolo true to rpcStart", async () => {
		const mockRpcStart = vi.mocked(ipc.rpcStart).mockResolvedValue({
			sessionId: "s_123",
			sessionFile: "/tmp/s_123.jsonl",
			pid: 999,
			cwd: "/tmp",
		});

		const result = await createSession({
			cwd: "/tmp",
			planYolo: true,
		});

		expect(mockRpcStart).toHaveBeenCalledWith({
			cwd: "/tmp",
			model: null,
			approvalMode: null,
			planYolo: true,
		});
		expect(result.sessionId).toBe("s_123");
		expect(result.stub.id).toBe("s_123");
	});

	it("forwards planYolo null when omitted", async () => {
		const mockRpcStart = vi.mocked(ipc.rpcStart).mockResolvedValue({
			sessionId: "s_456",
			sessionFile: "/tmp/s_456.jsonl",
			pid: 1000,
			cwd: "/workspace",
		});

		await createSession({
			cwd: "/workspace",
		});

		expect(mockRpcStart).toHaveBeenCalledWith({
			cwd: "/workspace",
			model: null,
			approvalMode: null,
			planYolo: null,
		});
	});

	it("forwards planYolo false when false", async () => {
		const mockRpcStart = vi.mocked(ipc.rpcStart).mockResolvedValue({
			sessionId: "s_789",
			sessionFile: "/tmp/s_789.jsonl",
			pid: 1001,
			cwd: "/workspace",
		});

		await createSession({
			cwd: "/workspace",
			planYolo: false,
		});

		expect(mockRpcStart).toHaveBeenCalledWith({
			cwd: "/workspace",
			model: null,
			approvalMode: null,
			planYolo: false,
		});
	});

	it("fills stub git and repoRoot from the cwd probes", async () => {
		vi.mocked(ipc.rpcStart).mockResolvedValue({
			sessionId: "s_git",
			sessionFile: "/tmp/s_git.jsonl",
			pid: 1002,
			cwd: "/repo",
		});
		vi.mocked(ipc.gitBadge).mockResolvedValue({
			branch: "main",
			dirty: 2,
			worktree: null,
		});
		vi.mocked(ipc.gitRepoRoot).mockResolvedValue("/repo");

		const result = await createSession({ cwd: "/repo" });

		expect(ipc.gitBadge).toHaveBeenCalledWith("/repo");
		expect(ipc.gitRepoRoot).toHaveBeenCalledWith("/repo");
		expect(result.stub.git).toEqual({
			branch: "main",
			dirty: 2,
			worktree: null,
		});
		expect(result.stub.repoRoot).toBe("/repo");
	});

	it("leaves git null when the probes fail", async () => {
		vi.mocked(ipc.rpcStart).mockResolvedValue({
			sessionId: "s_nogit",
			sessionFile: "/tmp/s_nogit.jsonl",
			pid: 1003,
			cwd: "/not-a-repo",
		});
		vi.mocked(ipc.gitBadge).mockRejectedValue(new Error("no git"));
		vi.mocked(ipc.gitRepoRoot).mockRejectedValue(new Error("no git"));

		const result = await createSession({ cwd: "/not-a-repo" });

		expect(result.stub.git).toBeNull();
		expect(result.stub.repoRoot).toBeNull();
	});
});
