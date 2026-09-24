import { describe, expect, it } from "vitest";
import { describeSelection, parseUnifiedDiff } from "./diff";

const DIFF = `diff --git a/a.ts b/a.ts
index 111..222 100644
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line3
diff --git a/b.md b/b.md
new file mode 100644
--- /dev/null
+++ b/b.md
@@ -0,0 +1,2 @@
+# title
+body
`;

describe("parseUnifiedDiff", () => {
	it("kinds and numbers lines per file", () => {
		const lines = parseUnifiedDiff(DIFF);
		const add = lines.find((l) => l.text === "new");
		expect(add?.kind).toBe("add");
		expect(add?.newNo).toBe(2);
		const del = lines.find((l) => l.text === "old");
		expect(del?.kind).toBe("del");
		expect(del?.oldNo).toBe(2);
		// Second file's hunk restarts numbering and carries its own path.
		const title = lines.find((l) => l.text === "# title");
		expect(title?.file).toBe("b.md");
		expect(title?.newNo).toBe(1);
	});

	it("marks headers and hunks as non-content", () => {
		const lines = parseUnifiedDiff(DIFF);
		expect(lines[0].kind).toBe("meta");
		expect(lines.find((l) => l.text.startsWith("@@ -1,3"))?.kind).toBe("hunk");
	});

	it("handles empty input", () => {
		expect(parseUnifiedDiff("")).toEqual([]);
	});
});

describe("describeSelection", () => {
	it("summarizes a range with file and line span", () => {
		const lines = parseUnifiedDiff(DIFF);
		const from = lines.findIndex((l) => l.text === "old");
		const to = lines.findIndex((l) => l.text === "added");
		const d = describeSelection(lines, from, to);
		expect(d.file).toBe("a.ts");
		expect(d.lines).toBe("2-3");
		expect(d.text).toContain("-old");
		expect(d.text).toContain("+new");
		expect(d.text).toContain("+added");
	});

	it("accepts a reversed range", () => {
		const lines = parseUnifiedDiff(DIFF);
		const a = lines.findIndex((l) => l.text === "old");
		const b = lines.findIndex((l) => l.text === "new");
		expect(describeSelection(lines, b, a).lines).toBe("2");
	});
});
