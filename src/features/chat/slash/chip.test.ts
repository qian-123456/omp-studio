const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;

import { describe, expect, it } from "vitest";
import { chipLabel, isSkillChip, loadChip, saveChip, serializeChip } from "./chip";

describe("serializeChip — chip ↔ wire text", () => {
	it("serializes chip + args to the literal /name args form", () => {
		expect(serializeChip({ name: "fork", title: "分叉" }, "fix the bug")).toBe(
			"/fork fix the bug",
		);
		expect(serializeChip({ name: "plan", title: "规划模式" }, "")).toBe("/plan");
		expect(serializeChip({ name: "goal", title: "目标" }, "ship v2")).toBe(
			"/goal ship v2",
		);
	});

	it("produces exactly what the user would have typed", () => {
		// Contract: identical to manual `/name args` input.
		expect(serializeChip({ name: "fork", title: "x" }, "a b")).toBe("/fork a b");
		// whitespace-only args collapse to the bare command
		expect(serializeChip({ name: "fork", title: "x" }, "   ")).toBe("/fork");
	});

	it("passes plain text through when no chip is set", () => {
		expect(serializeChip(null, "hello")).toBe("hello");
		expect(serializeChip(undefined, "/fork hi")).toBe("/fork hi");
	});

	it("trims outer whitespace but keeps the args body", () => {
		expect(serializeChip({ name: "fork", title: "x" }, "  q  ")).toBe("/fork q");
	});
});

describe("chip persistence", () => {
	it("round-trips a chip per session", () => {
		saveChip("s1", { name: "fork", title: "分叉" });
		saveChip("s2", { name: "skill:x", title: "x" });
		expect(loadChip("s1")).toEqual({ name: "fork", title: "分叉" });
		expect(loadChip("s2")).toEqual({ name: "skill:x", title: "x" });
		expect(loadChip("s3")).toBeNull();
	});

	it("clears on saveChip(null) and survives reloads", () => {
		saveChip("s1", { name: "goal", title: "目标" });
		saveChip("s1", null);
		expect(loadChip("s1")).toBeNull();
	});

	it("rejects malformed stored entries", () => {
		mem.set("ompws:command-chips", JSON.stringify({ s1: { name: "a b" }, s2: "x" }));
		expect(loadChip("s1")).toBeNull();
		expect(loadChip("s2")).toBeNull();
	});
});

describe("skill chip", () => {
	const skill = { name: "skill:grill-me", title: "grill-me", argHint: "arguments" };

	it("shows the bare skill name without the skill: prefix", () => {
		expect(isSkillChip(skill)).toBe(true);
		expect(chipLabel(skill)).toBe("grill-me");
		expect(isSkillChip({ name: "skill:", title: "x" })).toBe(false);
		expect(isSkillChip({ name: "fork", title: "分叉" })).toBe(false);
	});

	it("still serializes to the literal /skill:name args wire text", () => {
		expect(serializeChip(skill, "")).toBe("/skill:grill-me");
		expect(serializeChip(skill, "review this")).toBe("/skill:grill-me review this");
	});

	it("persists the ghost argHint across reloads", () => {
		saveChip("sk1", skill);
		expect(loadChip("sk1")).toEqual(skill);
	});
});
