// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyMsgSize } from "./displayPrefs";
import {
	APPROVAL_MODES,
	SETTING_GROUPS,
	clampInt,
	isApprovalMode,
	msgSizeFromPref,
	parseIntInput,
	visibleGroups,
} from "./settingsMap";

describe("OMP setting rows", () => {
	it("never exposes tools.approvalMode (permission section owns it)", () => {
		expect(SETTING_GROUPS.flatMap((g) => g.items.map((i) => i.key))).not.toContain("tools.approvalMode");
	});
	it("shows only the keys the server returned", () => {
		const g = visibleGroups({ "ask.enabled": true, "retry.maxRetries": 3 });
		expect(g.map((x) => x.title)).toEqual(["执行与审批", "出错重试"]);
		expect(g.flatMap((x) => x.items.map((i) => i.key))).toEqual(["ask.enabled", "retry.maxRetries"]);
		expect(visibleGroups({})).toEqual([]);
		expect(visibleGroups(undefined)).toEqual([]);
	});
	it("clamps and parses integer inputs", () => {
		const def = { min: 0, max: 100 };
		expect(clampInt(def, 250)).toBe(100);
		expect(clampInt(def, -3)).toBe(0);
		expect(clampInt(def, 4.6)).toBe(5);
		expect(parseIntInput(def, "")).toBeNull();
		expect(parseIntInput(def, "abc")).toBeNull();
		expect(parseIntInput(def, "999")).toBe(100);
	});
});

describe("approval modes", () => {
	it("accepts exactly the backend values", () => {
		expect(APPROVAL_MODES.map((m) => m.value)).toEqual(["always-ask", "write", "yolo"]);
		expect(isApprovalMode("yolo")).toBe(true);
		expect(isApprovalMode("ask")).toBe(false);
		expect(isApprovalMode(null)).toBe(false);
	});
});

describe("message size pref", () => {
	it("falls back to 标准 for unknown stored values", () => {
		expect(msgSizeFromPref("xl")).toBe("xl");
		expect(msgSizeFromPref("huge")).toBe("m");
		expect(msgSizeFromPref(undefined)).toBe("m");
	});
	it("publishes data attribute and px variable on <html>", () => {
		applyMsgSize("l");
		expect(document.documentElement.dataset.msgSize).toBe("l");
		expect(document.documentElement.style.getPropertyValue("--m-msg-fs")).toBe("18px");
	});
});
