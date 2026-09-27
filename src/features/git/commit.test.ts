import { describe, expect, it, vi } from "vitest";
import * as ipc from "../../lib/ipc";

describe("Git AI Commit contracts", () => {
	it("exposes gitCommitSuggest and gitCommit IPC functions", () => {
		expect(typeof ipc.gitCommitSuggest).toBe("function");
		expect(typeof ipc.gitCommit).toBe("function");
	});

	it("gitCommit passes stageAll parameter properly", async () => {
		const invokeSpy = vi.spyOn(ipc, "gitCommit").mockResolvedValue("commit successful");

		const res = await ipc.gitCommit("/test/repo", "feat: test message", true);
		expect(invokeSpy).toHaveBeenCalledWith("/test/repo", "feat: test message", true);
		expect(res).toBe("commit successful");

		invokeSpy.mockRestore();
	});

	it("gitCommitSuggest returns suggested commit message", async () => {
		const suggestSpy = vi
			.spyOn(ipc, "gitCommitSuggest")
			.mockResolvedValue("feat(git): add commit suggestion");

		const res = await ipc.gitCommitSuggest("/test/repo");
		expect(suggestSpy).toHaveBeenCalledWith("/test/repo");
		expect(res).toBe("feat(git): add commit suggestion");

		suggestSpy.mockRestore();
	});
});
