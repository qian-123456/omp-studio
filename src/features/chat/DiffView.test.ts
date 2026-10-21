import { describe, expect, it } from "vitest";
import { buildSplitRows, diffCounts, parseDiff } from "./DiffView";

describe("DiffView diffCounts", () => {
	it("counts only added/removed lines, not context", () => {
		const parsed = parseDiff([" 7|ctx", "+8|a", "+9|b", "-10|c", " 11|ctx"].join("\n"));
		expect(parsed).toHaveLength(5);
		expect(diffCounts(parsed)).toEqual({ adds: 2, dels: 1 });
	});
});

describe("DiffView parseDiff", () => {
	it("parses private format diff lines", () => {
		const privateDiff = [
			" 38|const a = 1;",
			"+39|const b = 2;",
			"-40|const c = 3;",
		].join("\n");

		const parsed = parseDiff(privateDiff);
		expect(parsed).toEqual([
			{ kind: "ctx", line: 38, text: "const a = 1;" },
			{ kind: "add", line: 39, text: "const b = 2;" },
			{ kind: "del", line: 40, text: "const c = 3;" },
		]);
	});

	it("parses standard git diff with @@ hunk header", () => {
		const gitDiff = [
			"diff --git a/src/app.ts b/src/app.ts",
			"index 123..456 100644",
			"--- a/src/app.ts",
			"+++ b/src/app.ts",
			"@@ -10,3 +20,4 @@",
			" const x = 10;",
			"-const y = 20;",
			"+const y = 25;",
			"+const z = 30;",
			" const w = 40;",
		].join("\n");

		const parsed = parseDiff(gitDiff);
		expect(parsed).toEqual([
			{ kind: "ctx", line: 20, text: "const x = 10;" },
			{ kind: "del", line: 11, text: "const y = 20;" },
			{ kind: "add", line: 21, text: "const y = 25;" },
			{ kind: "add", line: 22, text: "const z = 30;" },
			{ kind: "ctx", line: 23, text: "const w = 40;" },
		]);
	});

	it("handles multi-hunk git diff correctly", () => {
		const multiHunk = [
			"@@ -1,2 +1,2 @@",
			"-first",
			"+first_mod",
			" keep",
			"@@ -50,2 +50,2 @@",
			" ctx50",
			"+add51",
			"-del51",
		].join("\n");

		const parsed = parseDiff(multiHunk);
		expect(parsed).toEqual([
			{ kind: "del", line: 1, text: "first" },
			{ kind: "add", line: 1, text: "first_mod" },
			{ kind: "ctx", line: 2, text: "keep" },
			{ kind: "ctx", line: 50, text: "ctx50" },
			{ kind: "add", line: 51, text: "add51" },
			{ kind: "del", line: 51, text: "del51" },
		]);
	});
});

describe("DiffView buildSplitRows", () => {
	it("pairs ctx lines across both sides and aligns add/del", () => {
		const lines = [
			{ kind: "ctx" as const, line: 1, text: "header" },
			{ kind: "del" as const, line: 2, text: "old line" },
			{ kind: "add" as const, line: 2, text: "new line" },
			{ kind: "add" as const, line: 3, text: "extra line" },
			{ kind: "ctx" as const, line: 4, text: "footer" },
		];

		const rows = buildSplitRows(lines);
		expect(rows).toHaveLength(4);

		// row 0: ctx
		expect(rows[0].left?.text).toBe("header");
		expect(rows[0].right?.text).toBe("header");

		// row 1: del vs add
		expect(rows[1].left?.text).toBe("old line");
		expect(rows[1].right?.text).toBe("new line");

		// row 2: null vs extra add
		expect(rows[2].left).toBeNull();
		expect(rows[2].right?.text).toBe("extra line");

		// row 3: ctx
		expect(rows[3].left?.text).toBe("footer");
		expect(rows[3].right?.text).toBe("footer");
	});
});
