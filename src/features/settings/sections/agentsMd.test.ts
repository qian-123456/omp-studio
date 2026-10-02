import { describe, expect, it } from "vitest";
import {
	MAX_EDIT_BYTES,
	checkBeforeSave,
	defaultProjectTarget,
	effectiveProjectTarget,
	isTooLargeToEdit,
	projectAgentsMdPath,
} from "./agentsMd";

describe("checkBeforeSave", () => {
	it("allows saving when disk matches what was loaded", () => {
		expect(checkBeforeSave("a", "a")).toEqual({ kind: "ok" });
		expect(checkBeforeSave(null, null)).toEqual({ kind: "ok" });
	});
	it("flags edits, creation and deletion made outside the app", () => {
		expect(checkBeforeSave("a", "b")).toEqual({ kind: "conflict", onDisk: "b" });
		expect(checkBeforeSave(null, "new")).toEqual({ kind: "conflict", onDisk: "new" });
		expect(checkBeforeSave("a", null)).toEqual({ kind: "conflict", onDisk: null });
	});
});

describe("project target", () => {
	it("native .omp/AGENTS.md shadows the root file only when non-empty", () => {
		expect(effectiveProjectTarget({ content: "x" }, { content: "y" })).toBe("native");
		expect(effectiveProjectTarget({ content: "x" }, { content: "  \n" })).toBe("root");
		expect(effectiveProjectTarget({ content: null }, { content: null })).toBeNull();
	});
	it("defaults to the loaded file, then an existing native file, then root", () => {
		expect(defaultProjectTarget({ content: "x" }, { content: null })).toBe("root");
		expect(defaultProjectTarget({ content: null }, { content: "" })).toBe("native");
		expect(defaultProjectTarget({ content: null }, { content: null })).toBe("root");
	});
	it("builds paths without doubled slashes", () => {
		expect(projectAgentsMdPath("/r/p/", "root")).toBe("/r/p/AGENTS.md");
		expect(projectAgentsMdPath("/r/p", "native")).toBe("/r/p/.omp/AGENTS.md");
	});
});

it("size guard counts UTF-8 bytes", () => {
	expect(isTooLargeToEdit("a".repeat(MAX_EDIT_BYTES))).toBe(false);
	expect(isTooLargeToEdit("中".repeat(MAX_EDIT_BYTES / 3 + 1))).toBe(true);
});
