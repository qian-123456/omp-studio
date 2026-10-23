import { describe, expect, it } from "vitest";
import { buildSplitRows, buildUnifiedSplitRows } from "./split";

describe("buildSplitRows", () => {
	it("pairs ctx lines to left and right", () => {
		const rows = buildSplitRows([
			{ kind: "ctx", line: 1, text: "hello" },
			{ kind: "ctx", line: 2, text: "world" },
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].left?.text).toBe("hello");
		expect(rows[0].right?.text).toBe("hello");
		expect(rows[0].left?.origIdx).toBe(0);
	});

	it("pairs del and add lines side by side", () => {
		const rows = buildSplitRows([
			{ kind: "del", line: 1, text: "old line" },
			{ kind: "add", line: 1, text: "new line" },
			{ kind: "add", line: 2, text: "extra line" },
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].left?.text).toBe("old line");
		expect(rows[0].right?.text).toBe("new line");
		expect(rows[1].left).toBeNull();
		expect(rows[1].right?.text).toBe("extra line");
	});
});

describe("buildUnifiedSplitRows", () => {
	it("emits headers for hunk and meta lines", () => {
		const rows = buildUnifiedSplitRows([
			{ kind: "meta", text: "diff --git a/x b/x" },
			{ kind: "hunk", text: "@@ -1,2 +1,2 @@" },
			{ kind: "ctx", text: "code", oldNo: 1, newNo: 1 },
		]);
		expect(rows).toHaveLength(3);
		expect(rows[0].type).toBe("header");
		expect(rows[1].type).toBe("header");
		expect(rows[2].type).toBe("diff");
	});

	it("aligns additions and deletions with respective line numbers", () => {
		const rows = buildUnifiedSplitRows([
			{ kind: "del", text: "del1", oldNo: 10 },
			{ kind: "del", text: "del2", oldNo: 11 },
			{ kind: "add", text: "add1", newNo: 20 },
		]);
		expect(rows).toHaveLength(2);
		if (rows[0].type === "diff") {
			expect(rows[0].left?.lineNo).toBe(10);
			expect(rows[0].left?.text).toBe("del1");
			expect(rows[0].right?.lineNo).toBe(20);
			expect(rows[0].right?.text).toBe("add1");
		}
		if (rows[1].type === "diff") {
			expect(rows[1].left?.lineNo).toBe(11);
			expect(rows[1].right).toBeNull();
		}
	});
});
