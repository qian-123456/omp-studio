import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLAT_DICTS, interpolate, t } from "./index";

const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;
const placeholders = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map((m) => m[1]).sort();

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("i18n dictionaries", () => {
	it("has an en-US entry for every zh-CN key", () => {
		expect([...FLAT_DICTS["en-US"].keys()].sort()).toEqual([...FLAT_DICTS["zh-CN"].keys()].sort());
	});

	it("has no untranslated Chinese left in en-US", () => {
		const leftovers = [...FLAT_DICTS["en-US"]].filter(([, v]) => CJK.test(v)).map(([k, v]) => `${k}: ${v}`);
		expect(leftovers).toEqual([]);
	});

	it("keeps the same {placeholders} in both locales", () => {
		const mismatched = [...FLAT_DICTS["zh-CN"]]
			.filter(([k, zh]) => placeholders(zh).join() !== placeholders(FLAT_DICTS["en-US"].get(k) ?? "").join())
			.map(([k]) => k);
		expect(mismatched).toEqual([]);
	});

	it("resolves every literal key passed to t()/tNow() in source", () => {
		const call = /\b(?:t|tr|tNow|translate)\(\s*["'`]([A-Za-z][\w-]*(?:\.[\w-]+)+)["'`]/g;
		const missing: string[] = [];
		for (const file of sourceFiles(join(__dirname, "../.."))) {
			for (const m of readFileSync(file, "utf8").matchAll(call)) {
				if (!FLAT_DICTS["zh-CN"].has(m[1])) missing.push(`${file.split("/src/")[1]}: ${m[1]}`);
			}
		}
		expect(missing).toEqual([]);
	});
});

describe("t()", () => {
	it("translates per locale with params", () => {
		expect(t("common.confirm", undefined, "zh-CN")).toBe("确认");
		expect(t("common.confirm", undefined, "en-US")).toBe("Confirm");
		const keys = { inKey: "Cmd++", outKey: "Cmd+-", resetKey: "Cmd+0" };
		expect(t("shortcuts.zoomHint", keys, "en-US")).toBe("Cmd++ zoom in, Cmd+- zoom out, Cmd+0 reset to 100%");
	});

	it("falls back to the raw key when missing", () => {
		expect(t("non.existent.key")).toBe("non.existent.key");
	});

	it("interpolates and leaves unknown tokens intact", () => {
		expect(interpolate("Hello {name}!", { name: "OMP" })).toBe("Hello OMP!");
		expect(interpolate("Missing {param}")).toBe("Missing {param}");
	});
});
