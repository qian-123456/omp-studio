import { describe, expect, it } from "vitest";
import { interpolate, t } from "./index";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";

function getLeafKeys(obj: unknown, prefix = ""): string[] {
	if (!obj || typeof obj !== "object") return [];
	const keys: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${k}` : k;
		if (typeof v === "string") {
			keys.push(fullKey);
		} else {
			keys.push(...getLeafKeys(v, fullKey));
		}
	}
	return keys.sort();
}

describe("i18n core", () => {
	it("maintains key parity between zh-CN and en-US dictionaries", () => {
		const zhKeys = getLeafKeys(zhCN);
		const enKeys = getLeafKeys(enUS);

		expect(zhKeys).toEqual(enKeys);
		expect(zhKeys.length).toBeGreaterThan(15);
	});

	it("translates common keys in zh-CN and en-US", () => {
		expect(t("common.confirm", undefined, "zh-CN")).toBe("确认");
		expect(t("common.confirm", undefined, "en-US")).toBe("Confirm");

		expect(t("common.cancel", undefined, "zh-CN")).toBe("取消");
		expect(t("common.cancel", undefined, "en-US")).toBe("Cancel");

		expect(t("settings.language", undefined, "zh-CN")).toBe("界面语言");
		expect(t("settings.language", undefined, "en-US")).toBe("Language");
	});

	it("interpolates parameters correctly", () => {
		expect(interpolate("Hello {name}!", { name: "OMP" })).toBe("Hello OMP!");
		expect(interpolate("{inKey} in, {outKey} out", { inKey: "Cmd++", outKey: "Cmd+-" })).toBe(
			"Cmd++ in, Cmd+- out",
		);
		expect(interpolate("Missing {param}")).toBe("Missing {param}");
	});

	it("supports t() with params in different locales", () => {
		const zhHint = t(
			"shortcuts.zoomHint",
			{ inKey: "Cmd++", outKey: "Cmd+-", resetKey: "Cmd+0" },
			"zh-CN",
		);
		expect(zhHint).toBe("Cmd++ 放大，Cmd+- 缩小，Cmd+0 恢复 100%");

		const enHint = t(
			"shortcuts.zoomHint",
			{ inKey: "Cmd++", outKey: "Cmd+-", resetKey: "Cmd+0" },
			"en-US",
		);
		expect(enHint).toBe("Cmd++ zoom in, Cmd+- zoom out, Cmd+0 reset to 100%");
	});

	it("falls back to default locale or raw key when key is missing", () => {
		// Non-existent key
		expect(t("non.existent.key")).toBe("non.existent.key");
	});
});
