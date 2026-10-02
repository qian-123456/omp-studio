import { describe, expect, it } from "vitest";
import {
	applyProjectRole,
	parseProjectRoles,
	BUILTIN_ROLES,
	customRoles,
	joinRoleValue,
	parseChain,
	roleValue,
	serializeChain,
	splitRoleValue,
	withChain,
	withRoleAssignment,
} from "./modelRoles";

describe("BUILTIN_ROLES", () => {
	it("covers all documented chat and model-kind roles", () => {
		const chat = BUILTIN_ROLES.filter((r) => r.kind === "chat").map((r) => r.id);
		const modelKind = BUILTIN_ROLES.filter((r) => r.kind === "modelKind").map(
			(r) => r.id,
		);
		expect(chat).toEqual([
			"default",
			"smol",
			"slow",
			"vision",
			"plan",
			"commit",
			"tiny",
			"memory",
			"task",
			"advisor",
		]);
		expect(modelKind).toEqual([
			"image",
			"web",
			"speech",
			"dictation",
			"judge",
		]);
	});
});

describe("splitRoleValue", () => {
	it("splits a selector with a thinking suffix", () => {
		expect(splitRoleValue("anthropic/claude-opus-4-5:high")).toEqual({
			selector: "anthropic/claude-opus-4-5",
			thinkingSuffix: "high",
		});
		expect(splitRoleValue("devin/swe-2:xhigh")).toEqual({
			selector: "devin/swe-2",
			thinkingSuffix: "xhigh",
		});
	});

	it("splits the bare-level and :auto suffixes", () => {
		expect(splitRoleValue("openai/gpt-5.6:max")).toEqual({
			selector: "openai/gpt-5.6",
			thinkingSuffix: "max",
		});
		expect(splitRoleValue("agnes-free/agnes-2.5-flash:auto")).toEqual({
			selector: "agnes-free/agnes-2.5-flash",
			thinkingSuffix: "auto",
		});
	});

	it("returns the whole string as selector when there is no suffix", () => {
		expect(splitRoleValue("openai/gpt-4.1-mini")).toEqual({
			selector: "openai/gpt-4.1-mini",
			thinkingSuffix: null,
		});
		expect(splitRoleValue("web/duckduckgo")).toEqual({
			selector: "web/duckduckgo",
			thinkingSuffix: null,
		});
	});

	it("keeps non-level colons inside the selector", () => {
		expect(splitRoleValue("localhost:11434/llama3")).toEqual({
			selector: "localhost:11434/llama3",
			thinkingSuffix: null,
		});
		// "@smol" has no colon at all.
		expect(splitRoleValue("@smol")).toEqual({
			selector: "@smol",
			thinkingSuffix: null,
		});
	});

	it("treats an unknown trailing word as part of the selector", () => {
		expect(splitRoleValue("openai/gpt-4:turbo")).toEqual({
			selector: "openai/gpt-4:turbo",
			thinkingSuffix: null,
		});
	});
});

describe("joinRoleValue", () => {
	it("round-trips with splitRoleValue", () => {
		for (const v of [
			"anthropic/claude-opus-4-5:high",
			"openai/gpt-4.1-mini",
			"web/duckduckgo",
			"devin/swe-2:auto",
		]) {
			const { selector, thinkingSuffix } = splitRoleValue(v);
			expect(joinRoleValue(selector, thinkingSuffix)).toBe(v);
		}
	});

	it("omits null/empty suffixes and drops invalid levels", () => {
		expect(joinRoleValue("openai/x", null)).toBe("openai/x");
		expect(joinRoleValue("openai/x", "")).toBe("openai/x");
		expect(joinRoleValue("openai/x", "ultra")).toBe("openai/x");
	});
});

describe("customRoles", () => {
	it("returns role ids not in the builtin catalog", () => {
		expect(
			customRoles({
				default: "openai/gpt-4.1-mini",
				designer: "google/gemini-3.8-flash:high",
				reviewer: "openai/gpt-5.6",
			}),
		).toEqual(["designer", "reviewer"]);
	});

	it("returns [] for an empty or all-builtin record", () => {
		expect(customRoles({})).toEqual([]);
		expect(customRoles({ smol: "openai/x", judge: "typesafe/jev" })).toEqual(
			[],
		);
	});
});

describe("roleValue", () => {
	it("returns the trimmed selector or null when unset", () => {
		expect(roleValue({ smol: " openai/x " }, "smol")).toBe("openai/x");
		expect(roleValue({}, "smol")).toBeNull();
		expect(roleValue({ smol: 42 }, "smol")).toBeNull();
		expect(roleValue({ smol: "  " }, "smol")).toBeNull();
	});
});

describe("withRoleAssignment", () => {
	it("assigns a selector without mutating the input", () => {
		const roles = { default: "openai/a" };
		const next = withRoleAssignment(roles, "smol", "openai/b");
		expect(next).toEqual({ default: "openai/a", smol: "openai/b" });
		expect(roles).toEqual({ default: "openai/a" });
	});

	it("removes the role when selector is null", () => {
		const roles = { default: "openai/a", smol: "openai/b" };
		expect(withRoleAssignment(roles, "smol", null)).toEqual({
			default: "openai/a",
		});
	});
});

describe("parseChain", () => {
	it("treats absent keys as unset", () => {
		expect(parseChain(undefined)).toEqual({ state: "unset", items: [] });
		expect(parseChain(null)).toEqual({ state: "unset", items: [] });
	});

	it("treats an explicit empty array as empty (no fallback)", () => {
		expect(parseChain([])).toEqual({ state: "empty", items: [] });
	});

	it("parses ordered selector lists including @role aliases", () => {
		expect(
			parseChain(["typesafe/jev-preview", "@tiny", "@smol", "@default"]),
		).toEqual({
			state: "list",
			items: ["typesafe/jev-preview", "@tiny", "@smol", "@default"],
		});
	});

	it("drops non-string entries and falls back to empty when nothing remains", () => {
		expect(parseChain(["openai/x", 3, null])).toEqual({
			state: "list",
			items: ["openai/x"],
		});
		expect(parseChain([3, null])).toEqual({ state: "empty", items: [] });
	});

	it("accepts a bare string as a one-item chain", () => {
		expect(parseChain("openai/x")).toEqual({
			state: "list",
			items: ["openai/x"],
		});
	});
});

describe("serializeChain", () => {
	it("round-trips empty and list states through JSON", () => {
		expect(serializeChain("empty", [])).toBe("[]");
		const json = serializeChain("list", ["openai/x", "@smol"]);
		expect(JSON.parse(json)).toEqual(["openai/x", "@smol"]);
		expect(parseChain(JSON.parse(json))).toEqual({
			state: "list",
			items: ["openai/x", "@smol"],
		});
	});

	it("returns an empty string for unset (callers rewrite the record)", () => {
		expect(serializeChain("unset", [])).toBe("");
	});
});

describe("withChain", () => {
	it("sets and removes a role's chain without mutating the input", () => {
		const chains = { web: ["web/exa"], tiny: [] };
		const added = withChain(chains, "judge", ["@smol"]);
		expect(added).toEqual({
			web: ["web/exa"],
			tiny: [],
			judge: ["@smol"],
		});
		expect(withChain(chains, "web", null)).toEqual({ tiny: [] });
		expect(chains).toEqual({ web: ["web/exa"], tiny: [] });
	});
});

describe("project modelRoles YAML", () => {
	const src = `# project config\ntheme: dark # keep\nmodelRoles:\n  # main model\n  default: anthropic/a\n  task: openai/b\n`;

	it("parses roles and preserves comments when setting", () => {
		expect(parseProjectRoles(src)).toEqual({
			ok: true,
			roles: { default: "anthropic/a", task: "openai/b" },
		});
		const out = applyProjectRole(src, "smol", "x/y:high");
		expect(out).toContain("# project config");
		expect(out).toContain("theme: dark # keep");
		expect(out).toContain("# main model");
		expect(parseProjectRoles(out)).toEqual({
			ok: true,
			roles: { default: "anthropic/a", task: "openai/b", smol: "x/y:high" },
		});
	});

	it("removing the last role drops modelRoles", () => {
		let out = applyProjectRole(src, "default", null);
		out = applyProjectRole(out, "task", null);
		expect(out).not.toContain("modelRoles");
		expect(out).toContain("theme: dark");
	});

	it("creates modelRoles from an empty file", () => {
		const out = applyProjectRole("", "default", "a/b");
		expect(parseProjectRoles(out)).toEqual({ ok: true, roles: { default: "a/b" } });
	});

	it("rejects invalid YAML and non-mapping top level", () => {
		expect(parseProjectRoles("a: [1,\n").ok).toBe(false);
		expect(parseProjectRoles("- a\n- b\n").ok).toBe(false);
		expect(() => applyProjectRole("a: [1,\n", "default", "x")).toThrow();
		expect(() => applyProjectRole("- a\n", "default", "x")).toThrow();
	});
});
