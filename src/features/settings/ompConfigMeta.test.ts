import { describe, expect, it } from "vitest";
import { ompConfigDescription, ompConfigOptionLabel, ompConfigOptions, ompConfigTitle } from "./ompConfigMeta";

describe("ompConfigOptions", () => {
	it("returns strict enum candidates with schema labels", () => {
		const opts = ompConfigOptions("tools.approvalMode");
		expect(opts?.map((o) => o.value)).toEqual(["always-ask", "write", "yolo"]);
		expect(opts?.[2].label).toBe("Yolo");
	});

	it("exposes curated choices for computer.display", () => {
		expect(ompConfigOptions("computer.display")?.map((o) => o.value)).toEqual(["all"]);
	});

	it("falls back to number presets when no strict values exist", () => {
		const opts = ompConfigOptions("compaction.thresholdPercent");
		expect(opts?.[0].value).toBe("default");
		expect(opts?.length).toBeGreaterThan(5);
	});

	it("returns null for free-form fields", () => {
		expect(ompConfigOptions("web_search.enabled")).toBeNull();
		expect(ompConfigOptions("unknown.key")).toBeNull();
	});
});

describe("ompConfigOptionLabel", () => {
	it("prefers the per-key Chinese override", () => {
		expect(ompConfigOptionLabel("power.sleepPrevention", { value: "display" })).toBe(
			"阻止显示器休眠",
		);
	});

	it("falls back to the shared Chinese value label", () => {
		expect(ompConfigOptionLabel("tools.approvalMode", { value: "yolo" })).toBe("全部放行");
	});

	it("uses the schema label, then the raw value", () => {
		expect(ompConfigOptionLabel("compaction.thresholdPercent", { value: "10", label: "10%" })).toBe(
			"10%",
		);
		expect(ompConfigOptionLabel("unknown.key", { value: "af_heart" })).toBe("af_heart");
	});

	it("skips Chinese overrides in en-US", () => {
		expect(ompConfigOptionLabel("tools.approvalMode", { value: "yolo", label: "Yolo" }, "en-US")).toBe(
			"Yolo",
		);
		expect(ompConfigTitle("tools.approvalMode", "en-US")).toBe("Tool Approval");
		expect(ompConfigDescription("tools.approvalMode", "", "en-US")).toContain("approval");
	});
});
