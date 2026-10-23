import { describe, expect, it } from "vitest";
import {
	BUILTIN_ROLES,
	buildWildcard,
	classifyChainEntry,
	classifyChainKey,
	customRoles,
	formatChainEntry,
	parseChain,
	parseWildcard,
	roleValue,
	ruleKeys,
	serializeChain,
	splitChainEntry,
	splitRoleValue,
	validateChainEntry,
	validateChainKey,
	withChain,
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

	it("splits the :off and :inherit suffixes", () => {
		expect(splitRoleValue("agnes-free/agnes-3.0-flash:off")).toEqual({
			selector: "agnes-free/agnes-3.0-flash",
			thinkingSuffix: "off",
		});
		expect(splitRoleValue("openai/gpt-5:inherit")).toEqual({
			selector: "openai/gpt-5",
			thinkingSuffix: "inherit",
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

describe("withChain key preservation", () => {
	it("keeps model/provider rule keys and their order on role writes", () => {
		const chains = {
			"openai/gpt-5": ["anthropic/x:high"],
			default: ["@smol"],
			"openrouter/google/*": [],
			"anthropic/*": ["openrouter/*"],
		};
		const next = withChain(chains, "default", ["@web"]);
		expect(Object.keys(next)).toEqual(["openai/gpt-5", "default", "openrouter/google/*", "anthropic/*"]);
		expect(next["openrouter/google/*"]).toEqual([]);
		expect(Object.keys(withChain(chains, "default", null))).toEqual([
			"openai/gpt-5",
			"openrouter/google/*",
			"anthropic/*",
		]);
	});
});

describe("splitChainEntry / formatChainEntry", () => {
	it("splits only real thinking levels", () => {
		expect(splitChainEntry("openai/gpt-5:high")).toEqual({ selector: "openai/gpt-5", level: "high" });
		expect(splitChainEntry("ollama/qwen:7b")).toEqual({ selector: "ollama/qwen:7b", level: null });
		expect(splitChainEntry("localhost:11434/x:max")).toEqual({ selector: "localhost:11434/x", level: "max" });
		expect(splitChainEntry("openai/x:auto")).toEqual({ selector: "openai/x:auto", level: null });
	});
	it("round-trips through formatChainEntry", () => {
		expect(formatChainEntry("openai/x", "low")).toBe("openai/x:low");
		expect(formatChainEntry(" openai/x ", null)).toBe("openai/x");
	});
});

describe("wildcards", () => {
	it("parses provider and prefixed wildcards", () => {
		expect(parseWildcard("openai/*")).toEqual({ provider: "openai", prefix: "" });
		expect(parseWildcard("openrouter/google/*")).toEqual({ provider: "openrouter", prefix: "google" });
		expect(parseWildcard("openrouter/a/b/*")).toEqual({ provider: "openrouter", prefix: "a/b" });
	});
	it("rejects malformed wildcards", () => {
		expect(parseWildcard("/*")).toBeNull();
		expect(parseWildcard("openai/gpt-*")).toBeNull();
		expect(parseWildcard("a/*/b/*")).toBeNull();
		expect(parseWildcard("openai")).toBeNull();
		expect(parseWildcard("a//*")).toBeNull();
	});
	it("builds wildcards and trims stray slashes/stars", () => {
		expect(buildWildcard("openai")).toBe("openai/*");
		expect(buildWildcard("openrouter", "google")).toBe("openrouter/google/*");
		expect(buildWildcard("openrouter", "/google/*")).toBe("openrouter/google/*");
		expect(buildWildcard(" openrouter ", "  ")).toBe("openrouter/*");
	});
});

describe("chain entry validation", () => {
	it("classifies entry kinds", () => {
		expect(classifyChainEntry("openai/gpt-5:high")).toBe("model");
		expect(classifyChainEntry("@smol")).toBe("role");
		expect(classifyChainEntry("anthropic/*")).toBe("wildcard");
		expect(classifyChainEntry("openrouter/google/*")).toBe("wildcard");
		expect(classifyChainEntry("gpt-5")).toBe("invalid");
		expect(classifyChainEntry("")).toBe("invalid");
	});
	it("flags bad shapes", () => {
		expect(validateChainEntry("openai/")).not.toBeNull();
		expect(validateChainEntry("/x")).not.toBeNull();
		expect(validateChainEntry("@")).not.toBeNull();
		expect(validateChainEntry("@a/b")).not.toBeNull();
		expect(validateChainEntry("openai/*:high")).not.toBeNull();
		expect(validateChainEntry("openai/gp*")).not.toBeNull();
		expect(validateChainEntry("open ai/x")).not.toBeNull();
		expect(validateChainEntry("ollama/qwen:7b")).toBeNull();
	});
});

describe("chain key validation", () => {
	it("classifies keys", () => {
		expect(classifyChainKey("default")).toBe("role");
		expect(classifyChainKey("openai/gpt-5")).toBe("model");
		expect(classifyChainKey("openai/*")).toBe("provider");
		expect(classifyChainKey("openrouter/google/*")).toBe("prefix");
		expect(classifyChainKey("a/gp*")).toBe("invalid");
		expect(classifyChainKey("agent:x")).toBe("invalid");
	});
	it("rejects empty and suffixed keys", () => {
		expect(validateChainKey("")).not.toBeNull();
		expect(validateChainKey("openai/x:high")).not.toBeNull();
		expect(validateChainKey("ollama/qwen:7b")).toBeNull();
	});
	it("ruleKeys picks only slash keys", () => {
		expect(ruleKeys({ smol: [], "a/b": [], "a/*": [] })).toEqual(["a/b", "a/*"]);
	});
});
