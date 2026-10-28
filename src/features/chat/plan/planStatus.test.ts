import { describe, expect, it } from "vitest";
import { diffPlanLines, effectiveExecMode, parsePlanStatus, planSections } from "./planStatus";

describe("parsePlanStatus", () => {
	it("rejects foreign or malformed status text", () => {
		expect(parsePlanStatus("not json")).toBeNull();
		expect(parsePlanStatus(JSON.stringify({ v: 2, enabled: true }))).toBeNull();
		expect(parsePlanStatus(undefined)).toBeNull();
	});

	it("maps an off status to a disabled state and keeps review fields", () => {
		expect(parsePlanStatus(JSON.stringify({ v: 1, enabled: false }))?.enabled).toBe(false);
		const s = parsePlanStatus(
			JSON.stringify({
				v: 1,
				enabled: true,
				phase: "review",
				content: "# T\n## A",
				version: 2,
				tiers: [{ role: "smol", spec: "p/m:low" }, { role: 3 }],
				keepDisabled: true,
			}),
		);
		expect(s).toMatchObject({ enabled: true, phase: "review", version: 2, keepDisabled: true });
		expect(s?.tiers).toEqual([{ role: "smol", spec: "p/m:low" }]);
	});
});

describe("plan helpers", () => {
	it("lists ## sections outside code fences", () => {
		expect(planSections("# T\n## A\n```\n## not\n```\n## B ##")).toEqual(["A", "B"]);
	});

	it("falls back from keep to compact when context is full", () => {
		expect(effectiveExecMode("keep", { keepDisabled: true })).toBe("compact");
		expect(effectiveExecMode("keep", { keepDisabled: false })).toBe("keep");
		expect(effectiveExecMode("execute", { keepDisabled: true })).toBe("execute");
	});

	it("diffs plan versions line by line", () => {
		expect(diffPlanLines("a\nb\nc", "a\nc\nd")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "del", text: "b" },
			{ kind: "same", text: "c" },
			{ kind: "add", text: "d" },
		]);
	});
});
