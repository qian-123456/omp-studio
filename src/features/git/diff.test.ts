import { describe, expect, it } from "vitest";
import {
	describeSelection,
	describeSelectionSegments,
	groupDiffFiles,
	isFileHeaderMeta,
	parseUnifiedDiff,
} from "./diff";

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

	it("splits cross-hunk selection into separate segments without min-max merging", () => {
		const multiHunkDiff = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -10,3 +10,3 @@
 ctx1
-hunk1_del
+hunk1_add
 ctx2
@@ -80,3 +80,3 @@
 ctx80
-hunk2_del
+hunk2_add
 ctx82
`;
		const lines = parseUnifiedDiff(multiHunkDiff);
		const from = lines.findIndex((l) => l.text === "hunk1_del");
		const to = lines.findIndex((l) => l.text === "hunk2_add");

		const segs = describeSelectionSegments(lines, from, to);
		expect(segs).toHaveLength(2);
		expect(segs[0].lines).toBe("11-12");
		expect(segs[0].text).toContain("-hunk1_del");
		expect(segs[0].text).toContain("+hunk1_add");

		expect(segs[1].lines).toBe("80-81");
		expect(segs[1].text).toContain("-hunk2_del");
		expect(segs[1].text).toContain("+hunk2_add");

		const combined = describeSelection(lines, from, to);
		expect(combined.lines).toBe("11-12, 80-81");
		// Crucially, lines must NOT be "11-81" (the old min-max bug)
		expect(combined.lines).not.toBe("11-81");
	});

	it("splits cross-file selection into separate segments", () => {
		const lines = parseUnifiedDiff(DIFF);
		const from = lines.findIndex((l) => l.text === "old");
		const to = lines.findIndex((l) => l.text === "body");
		const segs = describeSelectionSegments(lines, from, to);
		expect(segs.length).toBeGreaterThanOrEqual(2);
		expect(segs[0].file).toBe("a.ts");
		expect(segs[segs.length - 1].file).toBe("b.md");
	});
});

describe("groupDiffFiles", () => {
	it("splits per file with counts, status and original index ranges", () => {
		const lines = parseUnifiedDiff(DIFF);
		const files = groupDiffFiles(lines);
		expect(files.map((f) => [f.path, f.status, f.adds, f.dels])).toEqual([
			["a.ts", "modified", 2, 1],
			["b.md", "added", 2, 0],
		]);
		expect(files[0].start).toBe(0);
		expect(files[0].end).toBe(files[1].start);
		expect(files[1].end).toBe(lines.length);
		expect(lines[files[1].start].text).toBe("diff --git a/b.md b/b.md");
	});

	it("keeps a commit preamble and detects renames, deletions, binaries", () => {
		const text = `commit abc
Author: x

    msg
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
diff --git a/gone.png b/gone.png
deleted file mode 100644
Binary files a/gone.png and /dev/null differ
`;
		const lines = parseUnifiedDiff(text);
		const files = groupDiffFiles(lines);
		expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
			[null, "modified", false],
			["new.ts", "renamed", false],
			["gone.png", "deleted", true],
		]);
		expect(files[1].oldPath).toBe("old.ts");
		expect(isFileHeaderMeta(lines[files[1].start])).toBe(true);
		expect(
			lines.filter((l) => l.text.startsWith("Binary")).some(isFileHeaderMeta),
		).toBe(false);
	});

	it("groups a bare ---/+++ diff without diff --git", () => {
		const files = groupDiffFiles(
			parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"),
		);
		expect(files.map((f) => [f.path, f.adds, f.dels])).toEqual([["x", 1, 1]]);
	});
});
