import { describe, expect, it } from "vitest";
import { emptySessionLive, hasLiveUserActivity } from "../../stores/live";
import type { TranscriptItem } from "../../lib/contracts";

import { validateBranchName } from "./branchName";

describe("validateBranchName", () => {
	it("accepts valid git branch names", () => {
		expect(validateBranchName("main")).toBeNull();
		expect(validateBranchName("omp/new-feature")).toBeNull();
		expect(validateBranchName("codex/task-123")).toBeNull();
	});

	it("rejects branch names ending or starting with slash", () => {
		expect(validateBranchName("codex/")).toBe("分支名不能以“/”结尾。");
		expect(validateBranchName("/feature")).toBe("分支名不能以“/”开头。");
	});

	it("rejects branch names with spaces", () => {
		expect(validateBranchName("my feature")).toBe("分支名不能包含空格。");
	});

	it("rejects invalid characters and double dots", () => {
		expect(validateBranchName("feat~1")).toBe("分支名包含无效字符。");
		expect(validateBranchName("feat..branch")).toBe("分支名不能包含“..”。");
	});
});

const fakeItem = { id: "i1" } as TranscriptItem;

describe("hasLiveUserActivity", () => {
	it("treats missing or fresh live state as blank", () => {
		expect(hasLiveUserActivity(undefined)).toBe(false);
		expect(hasLiveUserActivity(null)).toBe(false);
		expect(hasLiveUserActivity(emptySessionLive())).toBe(false);
	});

	it("is true once any transcript item exists", () => {
		const live = { ...emptySessionLive(), items: [fakeItem] };
		expect(hasLiveUserActivity(live)).toBe(true);
	});

	it("is true for an unconfirmed user echo", () => {
		const live = {
			...emptySessionLive(),
			pendingUserEchoes: [fakeItem],
		};
		expect(hasLiveUserActivity(live)).toBe(true);
	});

	it("is true while a turn is streaming or has a streaming snapshot", () => {
		expect(
			hasLiveUserActivity({ ...emptySessionLive(), streaming: true }),
		).toBe(true);
		expect(
			hasLiveUserActivity({
				...emptySessionLive(),
				streamingMessage: { role: "assistant", content: null },
			}),
		).toBe(true);
	});
});
