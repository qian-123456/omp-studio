import { describe, expect, it } from "vitest";
import type { ModelRoleSnapshot } from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { concreteLevel, effectiveRoles, planRoleScope, resolvePlanChoice, savedPlanValue } from "./planModelChoice";

const models: ModelOption[] = [{ provider: "anthropic", id: "opus", name: "Opus" }];

function snap(global: Record<string, string>, project: Record<string, string> | null): ModelRoleSnapshot {
	const layer = (modelRoles: Record<string, string>) => ({
		path: "",
		exists: true,
		modelRoles,
		agentModelOverrides: {},
	});
	return { global: layer(global), project: project ? layer(project) : null, agents: [] } as unknown as ModelRoleSnapshot;
}

const base = { edit: null, statusSpec: null, roles: {}, models } as const;

describe("resolvePlanChoice", () => {
	it("prefers the in-visit edit, then the status spec, then the role", () => {
		const roles = { plan: "p/role:low" };
		expect(resolvePlanChoice({ ...base, roles, edit: "p/edit:high", statusSpec: "p/status" })?.key).toBe("p/edit");
		expect(resolvePlanChoice({ ...base, roles, statusSpec: "p/status:medium" })).toMatchObject({
			key: "p/status",
			level: "medium",
		});
		expect(resolvePlanChoice({ ...base, roles, statusSpec: "  " })?.key).toBe("p/role");
	});

	it("is null when nothing names a plan model", () => {
		expect(resolvePlanChoice(base)).toBeNull();
		expect(resolvePlanChoice({ ...base, roles: { plan: "" } })).toBeNull();
	});

	it("follows @role chains and keeps the selector for later level edits", () => {
		const c = resolvePlanChoice({ ...base, statusSpec: "@slow:high", roles: { slow: "anthropic/opus:low" } });
		expect(c).toMatchObject({ key: "anthropic/opus", level: "high", selector: "@slow" });
		expect(resolvePlanChoice({ ...base, statusSpec: "@gone" })).toBeNull();
	});

	it("resolves a bare model id through the catalog", () => {
		expect(resolvePlanChoice({ ...base, statusSpec: "opus" })?.key).toBe("anthropic/opus");
	});

	it("treats auto and inherit as no concrete level", () => {
		expect(resolvePlanChoice({ ...base, statusSpec: "p/m:auto" })?.level).toBeNull();
		expect(resolvePlanChoice({ ...base, statusSpec: "p/m:inherit" })?.level).toBeNull();
		expect(concreteLevel("off")).toBe("off");
	});
});

describe("planRoleScope / effectiveRoles", () => {
	it("writes project only when the project layer pins its own plan", () => {
		expect(planRoleScope(snap({ plan: "a/b" }, { plan: "c/d" }))).toBe("project");
		expect(planRoleScope(snap({ plan: "a/b" }, { smol: "c/d" }))).toBe("global");
		expect(planRoleScope(snap({}, null))).toBe("global");
		expect(planRoleScope(null)).toBe("global");
	});

	it("lets the project layer override global per key", () => {
		expect(effectiveRoles(snap({ plan: "a/b", smol: "x/y" }, { plan: "c/d" }))).toEqual({ plan: "c/d", smol: "x/y" });
		expect(effectiveRoles(null)).toEqual({});
	});
});

describe("savedPlanValue", () => {
	it("omits auto/empty suffixes and keeps concrete ones", () => {
		expect(savedPlanValue("p/m", "auto")).toBe("p/m");
		expect(savedPlanValue("p/m", null)).toBe("p/m");
		expect(savedPlanValue("p/m", "")).toBe("p/m");
		expect(savedPlanValue("p/m", "xhigh")).toBe("p/m:xhigh");
		expect(savedPlanValue("@slow", "off")).toBe("@slow:off");
	});
});
