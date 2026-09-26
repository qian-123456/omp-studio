import { describe, expect, it } from "vitest";
import { getFileKind } from "./FileIcon";

describe("getFileKind", () => {
	it("detects folders correctly", () => {
		expect(getFileKind("backend", true)).toBe("folder");
		expect(getFileKind("frontend", true)).toBe("folder");
		expect(getFileKind(".omp", true)).toBe("folder");
	});

	it("detects git files", () => {
		expect(getFileKind(".gitignore")).toBe("git");
		expect(getFileKind(".gitattributes")).toBe("git");
	});

	it("detects json files", () => {
		expect(getFileKind("project.config.json")).toBe("json");
		expect(getFileKind("project.private.config.json")).toBe("json");
		expect(getFileKind("package.json")).toBe("json");
		expect(getFileKind("data.json5")).toBe("json");
	});

	it("detects markdown files", () => {
		expect(getFileKind("README.md")).toBe("markdown");
		expect(getFileKind("doc.markdown")).toBe("markdown");
	});

	it("detects code files by extension", () => {
		expect(getFileKind("App.tsx")).toBe("typescript");
		expect(getFileKind("main.ts")).toBe("typescript");
		expect(getFileKind("index.js")).toBe("javascript");
		expect(getFileKind("main.rs")).toBe("rust");
		expect(getFileKind("script.py")).toBe("python");
		expect(getFileKind("index.html")).toBe("html");
		expect(getFileKind("style.css")).toBe("style");
		expect(getFileKind("build.sh")).toBe("shell");
	});

	it("detects configuration and lock files", () => {
		expect(getFileKind("config.yaml")).toBe("config");
		expect(getFileKind("Cargo.toml")).toBe("config");
		expect(getFileKind(".env")).toBe("config");
		expect(getFileKind(".env.local")).toBe("config");
		expect(getFileKind("pnpm-lock.yaml")).toBe("config");
		expect(getFileKind("Cargo.lock")).toBe("lock");
	});

	it("falls back to generic file", () => {
		expect(getFileKind("LICENSE")).toBe("file");
		expect(getFileKind("unknown.xyz")).toBe("file");
	});
});
