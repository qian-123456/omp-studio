import { describe, expect, it } from "vitest";
import type { AgentModelAssignment } from "../../lib/contracts";
import { agentFallbackRole, type AssignmentRow, buildAssignmentRows, checkAssignmentValue, checkName, describeAliasValue, referencedRoles, resolveRoleValue, roleUsers } from "./agentModelAssignments";
import { BUILTIN_ROLES } from "./modelRoles";

function agent(name: string, declaredModel: string | null): AgentModelAssignment {
	return {
		name,
		source: "builtin",
		declaredModel,
		effectiveModel: null,
		effectiveSource: "unresolved",
		reason: "",
	};
}

describe("resolveRoleValue", () => {
	it("treats an unset built-in role as unset, not as an error", () => {
		expect(resolveRoleValue("smol", [{}])).toEqual({ status: "unset" });
	});

	it("reports an unknown custom role as unresolved", () => {
		expect(resolveRoleValue("reviewer", [{}])).toMatchObject({
			status: "unresolved",
			reason: expect.stringContaining("@reviewer"),
		});
	});

	it("resolves a configured role to its literal model", () => {
		expect(resolveRoleValue("smol", [{ smol: "a/b:high" }])).toEqual({
			status: "model",
			selector: "a/b:high",
		});
	});

	it("gives the project value precedence per key and inherits the rest from global", () => {
		expect(resolveRoleValue("default", [{ default: "p/x" }, { default: "g/y" }])).toEqual({
			status: "model",
			selector: "p/x",
		});
		expect(resolveRoleValue("default", [{}, { default: "g/y" }])).toEqual({
			status: "model",
			selector: "g/y",
		});
	});

	it("looks up alias targets through the same layers", () => {
		// The project's smol points at slow, which only the global layer defines.
		expect(resolveRoleValue("smol", [{ smol: "@slow" }, { smol: "g/y", slow: "g/z" }])).toEqual({
			status: "model",
			selector: "g/z",
		});
		// The project's default aliases smol, which only the global layer defines.
		expect(resolveRoleValue("default", [{ default: "@smol" }, { smol: "g/y" }])).toEqual({
			status: "model",
			selector: "g/y",
		});
	});

	it("skips unset built-in candidates and takes the first one that resolves", () => {
		expect(resolveRoleValue("task", [{ task: "@slow, @smol" }, { smol: "g/y" }])).toEqual({
			status: "model",
			selector: "g/y",
		});
	});

	it("reports an unknown candidate instead of skipping past it", () => {
		expect(resolveRoleValue("task", [{ task: "@nope, @smol" }, { smol: "g/y" }])).toMatchObject({
			status: "unresolved",
			reason: expect.stringContaining("@nope"),
		});
	});

	it("reports a cycle with its route", () => {
		expect(resolveRoleValue("a", [{ a: "@b", b: "@a" }])).toMatchObject({
			status: "unresolved",
			reason: "循环引用：@a → @b → @a",
		});
	});

	it("follows alias chains of any length", () => {
		const chain: Record<string, string> = { r20: "x/y" };
		for (let i = 0; i < 20; i++) chain[`r${i}`] = `@r${i + 1}`;
		expect(resolveRoleValue("r0", [chain])).toEqual({ status: "model", selector: "x/y" });
	});
});

describe("describeAliasValue", () => {
	it("shows the model a level-suffixed reference reaches, with the level", () => {
		expect(describeAliasValue("@smol:high", [{ smol: "g/y" }])).toEqual({ tone: "ok", text: "→ g/y:high" });
	});

	it("uses the first candidate that resolves", () => {
		expect(describeAliasValue("@slow, @smol", [{ smol: "g/y" }])).toEqual({ tone: "ok", text: "→ g/y" });
	});

	it("names an unknown candidate in the error", () => {
		expect(describeAliasValue("@nope, @smol", [{ smol: "g/y" }])).toMatchObject({
			tone: "error",
			text: expect.stringContaining("@nope"),
		});
	});

	it("shows an unset built-in as a neutral fall-through, not an error", () => {
		expect(describeAliasValue("@smol", [{}])).toMatchObject({ tone: "muted" });
	});

	it("expands * and *:level to the default role", () => {
		expect(describeAliasValue("*", [{ default: "d/m" }])).toEqual({ tone: "ok", text: "→ d/m" });
		expect(describeAliasValue("*:low", [{ default: "d/m" }])).toEqual({ tone: "ok", text: "→ d/m:low" });
	});

	it("treats pi/ as a reference only for known roles", () => {
		expect(describeAliasValue("pi/custom", [{}])).toBeNull();
		expect(describeAliasValue("pi/custom", [{ custom: "x/y" }])).toEqual({ tone: "ok", text: "→ x/y" });
		expect(describeAliasValue("pi/smol", [{}])).toMatchObject({ tone: "muted" });
	});

	it("needs no note for plain selectors or empty values", () => {
		expect(describeAliasValue("anthropic/claude-opus-4-5:high", [{}])).toBeNull();
		expect(describeAliasValue("gpt-4o", [{}])).toBeNull();
		expect(describeAliasValue("", [{}])).toBeNull();
		expect(describeAliasValue(null, [{}])).toBeNull();
	});

	it("reports a cycle as an error", () => {
		expect(describeAliasValue("@a", [{ a: "@b", b: "@a" }])).toMatchObject({
			tone: "error",
			text: expect.stringContaining("循环引用"),
		});
	});
});

describe("referencedRoles", () => {
	it("names the role behind a level suffix, not the suffix", () => {
		expect(referencedRoles("@smol:high", [])).toEqual(["smol"]);
	});

	it("expands candidate lists in order without repeats", () => {
		expect(referencedRoles("@slow, @smol, @slow", [])).toEqual(["slow", "smol"]);
	});

	it("counts * as the default role and pi/ only for known roles", () => {
		expect(referencedRoles("*", [])).toEqual(["default"]);
		expect(referencedRoles("pi/smol", [])).toEqual(["smol"]);
		expect(referencedRoles("pi/custom", [])).toEqual([]);
	});

	it("ignores literal selectors", () => {
		expect(referencedRoles("anthropic/claude-opus-4-5:high", [])).toEqual([]);
	});
});

describe("checkAssignmentValue", () => {
	it("accepts selectors and references, with an optional level on any role", () => {
		for (const value of [
			"@smol",
			"@smol:high",
			"anthropic/claude-opus-4-5:high",
			"openai/gpt-4o",
			"pi/smol",
			"@image:high",
			"openai/gpt-image-1:high",
		]) {
			expect(checkAssignmentValue(value)).toEqual({ ok: true, value });
		}
	});

	it("trims surrounding whitespace before checking", () => {
		expect(checkAssignmentValue("  @smol  ")).toEqual({ ok: true, value: "@smol" });
	});

	it("refuses what the backend write check refuses", () => {
		for (const value of ["", "   ", "@smol, @slow", "*", "*:high", "a b", "x@y", "@", "@:high", "a/b$"]) {
			expect(checkAssignmentValue(value).ok).toBe(false);
		}
	});

	it("refuses an empty level after the colon", () => {
		expect(checkAssignmentValue("@smol:").ok).toBe(false);
	});

	it("refuses a second colon inside the level", () => {
		expect(checkAssignmentValue("@smol:a:b").ok).toBe(false);
	});

	it("refuses a role name the backend name check rejects", () => {
		expect(checkAssignmentValue("@smol/x").ok).toBe(false);
	});

	it("refuses a literal selector without a provider", () => {
		expect(checkAssignmentValue("gpt-4o").ok).toBe(false);
		expect(checkAssignmentValue("a:b").ok).toBe(false);
	});

	it("refuses an empty or non-name provider and an empty model", () => {
		for (const value of ["/b", "a/", "+a/b", "a:b/c"]) {
			expect(checkAssignmentValue(value).ok).toBe(false);
		}
	});

	it("accepts the model characters the backend allows after the first slash", () => {
		for (const value of ["a/b+c", "a//b", "a/b:c:d"]) {
			expect(checkAssignmentValue(value)).toEqual({ ok: true, value });
		}
	});

	it("enforces the 256-character limit", () => {
		expect(checkAssignmentValue("a/" + "b".repeat(254)).ok).toBe(true);
		expect(checkAssignmentValue("a/" + "b".repeat(255)).ok).toBe(false);
	});
});

describe("checkName", () => {
	it("accepts names the backend accepts", () => {
		for (const name of ["security-reviewer", "my.agent", "x_1"]) {
			expect(checkName(name)).toEqual({ ok: true, name });
		}
	});

	it("rejects empty names, other characters and names over 128 characters", () => {
		for (const name of ["", "bad name", "@x", "a/b", "a".repeat(129)]) {
			expect(checkName(name).ok).toBe(false);
		}
		expect(checkName("a".repeat(128)).ok).toBe(true);
	});
});

const NO_LAYER = { modelRoles: {}, agentModelOverrides: {} };

function rows(
	opts: {
		global?: Partial<typeof NO_LAYER>;
		project?: Partial<typeof NO_LAYER> | null;
		agents?: AgentModelAssignment[];
		session?: string | null;
	} = {},
) {
	return buildAssignmentRows({
		global: { ...NO_LAYER, ...opts.global },
		project: opts.project ? { ...NO_LAYER, ...opts.project } : null,
		agents: opts.agents ?? [],
		sessionModel: opts.session ?? null,
	});
}

function find(list: AssignmentRow[], name: string, kind: "role" | "agent" = "agent") {
	const row = list.find((r) => r.kind === kind && r.name === name);
	if (!row) throw new Error(`row ${kind}:${name} missing`);
	return row;
}

describe("buildAssignmentRows", () => {
	it("orders chat roles, custom roles, agents, then service roles", () => {
		const list = rows({
			global: { modelRoles: { zeta: "a/b" } },
			project: { modelRoles: { alpha: "c/d" } },
			agents: [agent("scout", "@smol"), agent("reviewer", "@slow")],
		});
		const chat = BUILTIN_ROLES.filter((r) => r.kind === "chat").map((r) => r.id);
		const service = BUILTIN_ROLES.filter((r) => r.kind === "modelKind").map((r) => r.id);
		expect(list.map((r) => r.name)).toEqual([...chat, "alpha", "zeta", "scout", "reviewer", ...service]);
		expect(list.map((r) => r.group)).toEqual([
			...chat.map(() => "chat"),
			"custom",
			"custom",
			"agent",
			"agent",
			...service.map(() => "service"),
		]);
		expect(find(list, "default", "role").label).toBe("主力模型");
	});

	it("omits an agent named like a role row unless it has an override", () => {
		expect(rows({ agents: [agent("task", "@task")] }).some((r) => r.kind === "agent")).toBe(false);
		const global = rows({
			global: { agentModelOverrides: { task: "a/b" } },
			agents: [agent("task", "@task")],
		});
		expect(find(global, "task").effective.model).toBe("a/b");
		const project = rows({
			project: { agentModelOverrides: { task: "a/b" } },
			agents: [agent("task", "@task")],
		});
		expect(find(project, "task").projectOverride).toBe("a/b");
		expect(find(project, "task", "role").kind).toBe("role");
	});

	it("level 1: a literal override wins and carries its thinking level", () => {
		const row = find(
			rows({
				global: {
					agentModelOverrides: { scout: "anthropic/x:high" },
					modelRoles: { smol: "p/small", task: "p/task" },
				},
				agents: [agent("scout", "@smol")],
				session: "p/session",
			}),
			"scout",
		);
		expect(row.steps.map((s) => s.level)).toEqual([1, 2, 3, 4]);
		expect(row.steps[0]).toMatchObject({
			field: "task.agentModelOverrides.scout",
			value: "anthropic/x:high",
			layer: "global",
			model: "anthropic/x:high",
		});
		expect(row.steps[1]).toMatchObject({ field: "scout 定义里的 model:", value: "@smol", model: "p/small" });
		expect(row.effective).toEqual({
			model: "anthropic/x:high",
			level: 1,
			via: null,
			inherited: false,
			error: null,
		});
		expect(row.thinking).toBe("high");
	});

	it("level 1: an @role override resolves through merged roles and reports via", () => {
		const row = find(
			rows({
				global: { agentModelOverrides: { scout: "@slow" }, modelRoles: { slow: "p/slow" } },
				project: { modelRoles: { slow: "p/project-slow" } },
				agents: [agent("scout", "@smol")],
			}),
			"scout",
		);
		expect(row.effective).toMatchObject({ model: "p/project-slow", level: 1, via: "@slow" });
	});

	it("level 1: a global override shadows a project override", () => {
		const row = find(
			rows({
				global: { agentModelOverrides: { scout: "g/m" } },
				project: { agentModelOverrides: { scout: "p/m" } },
				agents: [agent("scout", null)],
			}),
			"scout",
		);
		expect(row.projectShadowed).toBe(true);
		expect(row.globalOverride).toBe("g/m");
		expect(row.projectOverride).toBe("p/m");
		expect(row.steps[0]).toMatchObject({ value: "g/m", layer: "global" });
		expect(row.effective.model).toBe("g/m");
	});

	it("level 1: a project override applies when global has none", () => {
		const row = find(
			rows({ project: { agentModelOverrides: { scout: "p/m" } }, agents: [agent("scout", null)] }),
			"scout",
		);
		expect(row.projectShadowed).toBe(false);
		expect(row.steps[0]).toMatchObject({ value: "p/m", layer: "project" });
		expect(row.effective.model).toBe("p/m");
	});

	it("level 2: the declared @smol wins when no override is set", () => {
		const row = find(
			rows({ global: { modelRoles: { smol: "p/small", task: "p/task" } }, agents: [agent("scout", "@smol")] }),
			"scout",
		);
		expect(row.effective).toMatchObject({ model: "p/small", level: 2, via: "@smol" });
		expect(row.declared).toBe("@smol");
		expect(row.agentSource).toBe("builtin");
	});

	it("level 3: an unset built-in declared role falls through to modelRoles.task", () => {
		const row = find(
			rows({
				global: { modelRoles: { task: "g/task" } },
				project: { modelRoles: { task: "p/task" } },
				agents: [agent("scout", "@smol")],
				session: "p/session",
			}),
			"scout",
		);
		expect(row.steps[1].model).toBeNull();
		expect(row.steps[1].error).toBeNull();
		expect(row.steps[2]).toMatchObject({ value: "p/task", layer: "project", model: "p/task" });
		expect(row.effective).toMatchObject({ model: "p/task", level: 3, error: null });
	});

	it("level 4: falls to the session model when task is unset", () => {
		const row = find(rows({ agents: [agent("scout", "@smol")], session: "p/session" }), "scout");
		expect(row.steps[2]).toMatchObject({ value: null, layer: null, model: null });
		expect(row.steps[3]).toMatchObject({ level: 4, field: "当前会话模型", value: "p/session" });
		expect(row.effective).toMatchObject({ model: "p/session", level: 4, via: null });
	});

	it("level 4 without a session leaves the model null", () => {
		const row = find(rows({ agents: [agent("security-reviewer", null)] }), "security-reviewer");
		expect(row.effective).toMatchObject({ model: null, level: 4, error: null });
		expect(row.thinking).toBeNull();
	});

	it("stops at an unresolved alias with an error", () => {
		const row = find(
			rows({
				global: { agentModelOverrides: { scout: "@ghost" }, modelRoles: { task: "p/task" } },
				agents: [agent("scout", "@smol")],
				session: "p/session",
			}),
			"scout",
		);
		expect(row.steps[0].error).toContain("ghost");
		expect(row.effective.model).toBeNull();
		expect(row.effective.level).toBe(1);
		expect(row.effective.error).toContain("ghost");
	});

	it("reports a role cycle as an error on the role row", () => {
		const row = find(rows({ global: { modelRoles: { a: "@b", b: "@a" } } }), "a", "role");
		expect(row.effective.model).toBeNull();
		expect(row.effective.error).toContain("循环引用");
	});

	it("role rows: values per layer, alias via, thinking and inheritance flag", () => {
		const list = rows({
			global: { modelRoles: { default: "g/main", plan: "@slow", slow: "p/slow:high" } },
			project: { modelRoles: { smol: "p/small" } },
		});
		expect(find(list, "default", "role")).toMatchObject({
			globalValue: "g/main",
			projectValue: null,
			steps: [],
			effective: { model: "g/main", level: null, via: null, inherited: true, error: null },
		});
		expect(find(list, "smol", "role")).toMatchObject({
			globalValue: null,
			projectValue: "p/small",
			effective: { model: "p/small", inherited: false },
		});
		expect(find(list, "plan", "role")).toMatchObject({
			effective: { model: "p/slow:high", via: "@slow" },
			thinking: "high",
		});
		expect(find(list, "vision", "role").effective).toMatchObject({ model: null, inherited: false });
	});

	it("role rows are never inherited in global scope and carry no project value", () => {
		const row = find(rows({ global: { modelRoles: { default: "g/main" } } }), "default", "role");
		expect(row.projectValue).toBeNull();
		expect(row.effective.inherited).toBe(false);
	});
});

describe("roleUsers", () => {
	it("counts only the value an agent actually applies: an override hides its definition's model", () => {
		const global = {
			modelRoles: { review: "p/review", fast: "p/fast" },
			agentModelOverrides: { scout: "@review" },
		};
		const list = rows({ global, agents: [agent("scout", "@fast"), agent("reviewer", "@fast")] });
		const users = roleUsers(list, [global.modelRoles], []);
		expect(users.get("review")).toEqual(["子代理 scout"]);
		expect(users.get("fast")).toEqual(["子代理 reviewer"]);
	});

	it("counts other roles and cycleOrder but never a role as its own user", () => {
		const global = { modelRoles: { review: "p/review,@review", plan: "@review:high" } };
		const users = roleUsers(rows({ global }), [global.modelRoles], ["review", "default"]);
		expect(users.get("review")).toEqual(["角色 plan", "模型切换轮换（cycleOrder）"]);
	});

	it("leaves a role nobody references without callers", () => {
		const global = { modelRoles: { lonely: "p/x" } };
		expect(roleUsers(rows({ global }), [global.modelRoles], []).get("lonely")).toBeUndefined();
	});
});

describe("agentFallbackRole", () => {
	it("returns the declared role without its level, else @task", () => {
		const list = rows({
			agents: [agent("a", "@smol:high"), agent("b", "p/literal"), agent("c", null), agent("d", "@x, @y")],
		});
		expect(agentFallbackRole(find(list, "a"))).toBe("@smol");
		expect(agentFallbackRole(find(list, "b"))).toBe("@task");
		expect(agentFallbackRole(find(list, "c"))).toBe("@task");
		expect(agentFallbackRole(find(list, "d"))).toBe("@x");
	});
});
