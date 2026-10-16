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

import { findChipRange, inlineChipRange, insertChipAt, parseLeadingCommand, shiftChipOffset } from "./chip";

describe("inline skill chip (offset model)", () => {
	const base = { name: "skill:grill-me", title: "grill-me", argHint: "arguments" };
	const lit = "/skill:grill-me";

	it("inserts the token where the /query was typed", () => {
		const text = "long text here /gri";
		const r = insertChipAt(base, text, 15, text.length);
		expect(r.text).toBe(`long text here ${lit} `);
		expect(r.chip.offset).toBe(15);
		expect(r.caret).toBe(r.text.length);
		expect(inlineChipRange(r.chip, r.text)).toEqual({ start: 15, end: 15 + lit.length });
	});

	it("does not add a second space when whitespace follows", () => {
		const r = insertChipAt(base, "a /g b", 2, 4);
		expect(r.text).toBe(`a ${lit} b`);
	});

	it("serializes token to the front, joining the remaining text", () => {
		const c = { ...base, offset: 6 };
		expect(serializeChip(c, `hello ${lit} world`)).toBe("/skill:grill-me hello world");
		expect(serializeChip({ ...base, offset: 6 }, `hello\n${lit} world`)).toBe(
			"/skill:grill-me hello\nworld",
		);
		expect(serializeChip({ ...base, offset: 0 }, `${lit} `)).toBe("/skill:grill-me");
		expect(serializeChip({ ...base, offset: 4 }, `abc ${lit}`)).toBe("/skill:grill-me abc");
	});

	it("fuzzy locate tolerates shifted offsets (masked text)", () => {
		const c = { ...base, offset: 20 };
		expect(serializeChip(c, `[X] ${lit} y`)).toBe(`/skill:grill-me [X] ${lit} y`);
		expect(serializeChip(c, `[X] ${lit} y`, "fuzzy")).toBe("/skill:grill-me [X] y");
		expect(findChipRange(c, `a ${lit} ${lit}`, 100)?.start).toBe(`a ${lit} `.length);
	});

	it("shifts the offset for edits before, keeps it for edits after", () => {
		const L = lit.length;
		const prev = `ab ${lit} cd`;
		expect(shiftChipOffset(prev, `XXab ${lit} cd`, 3, L)).toBe(5); // insert before
		expect(shiftChipOffset(prev, `b ${lit} cd`, 3, L)).toBe(2); // delete before
		expect(shiftChipOffset(prev, `ab ${lit} cdEF`, 3, L)).toBe(3); // edit after
		expect(shiftChipOffset(prev, `ab ${lit}X cd`, 3, L)).toBe(3); // at literal end
		expect(shiftChipOffset(prev, `abX${lit} cd`.replace("abX", "ab X"), 3, L)).toBe(4); // insert at offset
		const o = shiftChipOffset(prev, "ab /skill: cd", 3, L); // overlap → edit start
		expect(o).toBe(10);
		expect(inlineChipRange({ ...base, offset: o }, "ab /skill: cd")).toBeNull();
	});

	it("invalidates when the literal is broken or glued to a word", () => {
		const c = { ...base, offset: 3 };
		expect(inlineChipRange(c, `ab ${lit} cd`)).not.toBeNull();
		expect(inlineChipRange(c, `ab ${lit}x cd`)).toBeNull();
		expect(inlineChipRange(c, "ab /skill:grill cd")).toBeNull();
	});

	it("persists the offset", () => {
		saveChip("off1", { ...base, offset: 7 });
		expect(loadChip("off1")).toEqual({ ...base, offset: 7 });
	});
});

describe("parseLeadingCommand", () => {
	it("splits a leading skill command from its text", () => {
		const r = parseLeadingCommand("/skill:grill-me 那你先给我做个计划");
		expect(r?.chip.name).toBe("skill:grill-me");
		expect(r?.rest).toBe("那你先给我做个计划");
	});
	it("handles bare skill and ignores plain text / unknown commands", () => {
		expect(parseLeadingCommand("/skill:x")?.rest).toBe("");
		expect(parseLeadingCommand("hello /skill:x")).toBeNull();
		expect(parseLeadingCommand("/definitely-not-a-command a")).toBeNull();
		expect(parseLeadingCommand("/skill:")).toBeNull();
	});
});
