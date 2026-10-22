import { describe, expect, it } from "vitest";
import type { TurnCheckpoint } from "../../lib/contracts";
import { promptPreview, shaToTurnMap } from "./turns";

const turn = (partial: Partial<TurnCheckpoint>): TurnCheckpoint =>
	({
		turnId: "t1",
		sessionId: "s1",
		userItemId: "u1",
		prompt: "帮我修一下登录",
		before: "b".repeat(40),
		after: "a".repeat(40),
		headBefore: null,
		headAfter: null,
		commits: [],
		files: [],
		endedAt: "2026-09-30T10:00:00Z",
		restorable: true,
		undone: false,
		...partial,
	}) as TurnCheckpoint;

describe("shaToTurnMap", () => {
	it("maps every listed commit sha to its turn", () => {
		const sha1 = "1".repeat(40);
		const sha2 = "2".repeat(40);
		const t = turn({ commits: [sha1, sha2] });
		const map = shaToTurnMap([t]);
		expect(map.get(sha1)).toBe(t);
		expect(map.get(sha2)).toBe(t);
		expect(map.size).toBe(2);
	});

	it("keeps the earliest turn when commits overlap", () => {
		const sha = "3".repeat(40);
		const first = turn({ turnId: "t1", commits: [sha] });
		const later = turn({ turnId: "t2", commits: [sha] });
		const map = shaToTurnMap([first, later]);
		expect(map.get(sha)?.turnId).toBe("t1");
	});

	it("ignores turns without commits and never-mapped shas", () => {
		const map = shaToTurnMap([turn({ commits: [] }), turn({ turnId: "t2", commits: ["4".repeat(40)] })]);
		expect(map.get("f".repeat(40))).toBeUndefined();
		expect(map.size).toBe(1);
	});
});

describe("promptPreview", () => {
	it("collapses image markers to 🖼️#N and keeps the prose", () => {
		expect(promptPreview("修正 skill [Image #1, 2560x1486: /Users/a/images/1.png] 看图 [Image #2: /b.png]")).toBe(
			"修正 skill 🖼️#1 看图 🖼️#2",
		);
		expect(promptPreview("看 [图片: /a.png]")).toBe("看 🖼️");
	});

	it("collapses a marker cut off by prompt truncation", () => {
		expect(promptPreview("改一下 [Image #1, 2560x1486: /Users/qianhairui/.omp-works…")).toBe("改一下 🖼️#1");
	});

	it("leaves plain text and brackets alone", () => {
		expect(promptPreview("fix [wip] thing")).toBe("fix [wip] thing");
	});
});
