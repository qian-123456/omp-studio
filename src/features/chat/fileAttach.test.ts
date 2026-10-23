import { describe, expect, it } from "vitest";
import {
	baseName,
	expandFilesForSend,
	getFileTokenRanges,
	isBinaryBytes,
	isProbablyBinaryPath,
	parseInlineFiles,
} from "./fileAttach";

describe("isProbablyBinaryPath", () => {
	it("flags office/archive/binary extensions", () => {
		for (const p of [
			"/tmp/report.docx",
			"/tmp/legacy.doc",
			"/tmp/sheet.xlsx",
			"/tmp/deck.PPTX",
			"/tmp/scan.pdf",
			"/tmp/a.zip",
			"/tmp/d.dmg",
			"/tmp/x.exe",
			"/tmp/x.sqlite",
			"/tmp/x.parquet",
			"/Users/me/My Pages.pages",
		]) {
			expect(isProbablyBinaryPath(p), p).toBe(true);
		}
	});
	it("keeps text/code/extensionless paths as text", () => {
		for (const p of [
			"/tmp/notes.md",
			"/tmp/main.ts",
			"/tmp/x.json",
			"/tmp/Makefile",
			"/tmp/noext",
			"/tmp/.hidden",
			"README",
		]) {
			expect(isProbablyBinaryPath(p), p).toBe(false);
		}
	});
});

describe("isBinaryBytes", () => {
	it("detects NUL bytes", () => {
		expect(isBinaryBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
	});
	it("detects invalid UTF-8", () => {
		expect(isBinaryBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
		expect(isBinaryBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
	});
	it("accepts plain and multibyte UTF-8 text", () => {
		const enc = new TextEncoder();
		expect(isBinaryBytes(enc.encode("hello world\nfn main() {}\n"))).toBe(false);
		expect(isBinaryBytes(enc.encode("中文文本与 🎉 emoji"))).toBe(false);
		expect(isBinaryBytes(new Uint8Array(0))).toBe(false);
	});
});

describe("parseInlineFiles", () => {
	it("parses 📎 draft tokens and [文件 #N: path] markers", () => {
		const text = "看 📎#1 和 📎 #2 还有 [文件 #3: /tmp/a.docx] 再 [File #4]";
		const tokens = parseInlineFiles(text);
		expect(tokens.map((t) => t.index)).toEqual([1, 2, 3, 4]);
		expect(tokens[2].path).toBe("/tmp/a.docx");
		expect(tokens[0].path).toBeUndefined();
	});
	it("returns ranges covering each token for atomic caret logic", () => {
		const text = "a 📎#2 b [文件 #1: /p/x.zip]";
		const ranges = getFileTokenRanges(text);
		expect(ranges).toHaveLength(2);
		expect(text.slice(ranges[0].start, ranges[0].end)).toBe("📎#2");
		expect(text.slice(ranges[1].start, ranges[1].end)).toBe("[文件 #1: /p/x.zip]");
	});
	it("ignores unrelated brackets and image markers", () => {
		expect(parseInlineFiles("not [a file] 🖼️#1 [Image #2: /p.png]")).toHaveLength(0);
	});
});

describe("baseName", () => {
	it("returns the last path component", () => {
		expect(baseName("/tmp/a/b.docx")).toBe("b.docx");
		expect(baseName("/tmp/dir/")).toBe("dir");
		expect(baseName("solo.txt")).toBe("solo.txt");
	});
});

describe("expandFilesForSend", () => {
	const files = [{ path: "/a.txt" }, { path: "/b.txt" }];

	it("expands tokens and appends markers for deleted tokens after a slash command", () => {
		expect(expandFilesForSend("/skill:x see 📎#2", files, "suffix")).toBe(
			"/skill:x see [文件 #2: /b.txt] [文件 #1: /a.txt]",
		);
	});

	it("prefixes missing markers by default", () => {
		expect(expandFilesForSend("hi", [{ path: "/a.txt" }])).toBe("[文件 #1: /a.txt] hi");
	});
});
