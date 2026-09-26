import { describe, expect, it } from "vitest";
import type { OmpConfigEntry } from "../../lib/contracts";
import {
	groupByOmpTab,
	groupByPrefix,
	keyPrefix,
	ompTabLabel,
} from "./ompConfigTabs";

function entry(key: string, tab: string): OmpConfigEntry {
	return {
		key,
		value: null,
		valueType: "string",
		description: "",
		redacted: false,
		tab,
	};
}

describe("ompTabLabel", () => {
	it("maps official tabs to Chinese labels", () => {
		expect(ompTabLabel("appearance")).toBe("外观");
		expect(ompTabLabel("providers")).toBe("供应商");
		expect(ompTabLabel("shell")).toBe("Shell");
	});

	it("renders unknown tab ids as-is", () => {
		expect(ompTabLabel("hologram")).toBe("hologram");
	});
});

describe("groupByOmpTab", () => {
	it("follows OMP's official tab order and sorts entries by key", () => {
		const groups = groupByOmpTab([
			entry("tools.read", "tools"),
			entry("model.temperature", "model"),
			entry("appearance.theme.dark", "appearance"),
			entry("model.defaultThinkingLevel", "model"),
		]);
		expect(groups.map((g) => g.id)).toEqual(["appearance", "model", "tools"]);
		expect(groups[1].label).toBe("模型");
		expect(groups[1].entries.map((e) => e.key)).toEqual([
			"model.defaultThinkingLevel",
			"model.temperature",
		]);
	});

	it("appends unknown tabs after the official ones, alphabetically", () => {
		const groups = groupByOmpTab([
			entry("zeta.key", "zeta"),
			entry("alpha.key", "alpha"),
			entry("tools.edit", "tools"),
		]);
		expect(groups.map((g) => g.id)).toEqual(["tools", "alpha", "zeta"]);
		expect(groups[1].label).toBe("alpha");
	});
});

describe("groupByPrefix", () => {
	it("segments by top-level prefix and sorts prefixes", () => {
		const groups = groupByPrefix([
			entry("statusLine.preset", "appearance"),
			entry("theme.dark", "appearance"),
			entry("symbolPreset", "appearance"),
			entry("theme.light", "appearance"),
		]);
		expect(groups.map(([p]) => p)).toEqual(["statusLine", "symbolPreset", "theme"]);
		expect(groups[2][1].map((e) => e.key)).toEqual(["theme.dark", "theme.light"]);
	});
});

describe("keyPrefix", () => {
	it("handles dotted and bare keys", () => {
		expect(keyPrefix("theme.dark")).toBe("theme");
		expect(keyPrefix("temperature")).toBe("temperature");
	});
});
