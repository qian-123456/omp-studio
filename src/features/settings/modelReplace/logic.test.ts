/**
 * Edge cases of the bulk-replace logic: matching, comma lists, thinking
 * suffixes, chain renames/merges/dedupe, plan grouping, retry merge and the
 * undo/history display.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
	ChainChange,
	ModelKindEntry,
	ModelReplaceEdit,
	ModelReplaceItemResult,
	ModelUsageRef,
	ModelUsageScan,
} from "../../../lib/contracts";
import { resolveThinkingLevels } from "../../../lib/models";
import {
	appSettingLabel,
	buildOverview,
	buildPlan,
	editKey,
	editsScopeLabel,
	filterOverviewRows,
	highlightParts,
	invertEdit,
	isModelSelector,
	listCandidates,
	type OverviewRow,
	liveSessionsOnModel,
	mergeResults,
	projectNameMap,
	replaceValue,
	roleTitle,
	sameModel,
	selectorOf,
	scopeOptions,
	searchTerms,
	sourceMatches,
	summarizeEdit,
	levelsForSelector,
	sanitizeOverrides,
	supportedLevel,
	THINKING_LEVELS,
	withLevel,
} from "./logic";

const OPUS = "anthropic/claude-opus";
const GPT = "openai/gpt-5";
const SMOL = "smol";

const roleRef = (name: string, value: string, scope: "global" | "project" = "global"): ModelUsageRef => ({
	location: scope === "global"
		? { kind: "role", scope, projectPath: null, name }
		: { kind: "role", scope, projectPath: "/repo/alpha", name },
	value,
	thinking: null,
});

const overrideRef = (name: string, value: string): ModelUsageRef => ({
	location: { kind: "agentOverride", scope: "global", projectPath: null, name },
	value,
	thinking: null,
});

const appRef = (field: "newSessionModel" | "sideChatModel" | "doctorModel", value: string): ModelUsageRef => ({
	location: { kind: "appSetting", field },
	value,
	thinking: null,
});

const scheduleRef = (id: string, name: string, value: string, thinking: string | null = null): ModelUsageRef => ({
	location: { kind: "schedule", id, name },
	value,
	thinking,
});

function scanOf(
	refs: ModelUsageRef[],
	chains: Record<string, string[]> = {},
	overrides: Partial<ModelUsageScan> = {},
): ModelUsageScan {
	return {
		refs,
		fallbackChains: { chains },
		fallbackChainsError: null,
		projects: [
			{ path: "/repo/alpha", name: "alpha", status: "ok", error: null },
			{ path: "/repo/beta", name: "beta", status: "ok", error: null },
		],
		...overrides,
	};
}

/** Narrow a planned edit to its chain changes (the planner only ever emits those for chain rows). */
function chainChanges(edit: ModelReplaceEdit | null): ChainChange[] {
	if (!edit || edit.kind !== "fallbackChain") throw new Error("expected a fallbackChain edit");
	return edit.changes;
}

describe("selector matching", () => {
	it("strips a known trailing thinking level and keeps other colons", () => {
		expect(selectorOf(`${OPUS}:high`)).toBe(OPUS);
		expect(selectorOf(`${OPUS}:auto`)).toBe(OPUS);
		expect(selectorOf(`${OPUS}:weird`)).toBe(`${OPUS}:weird`);
		expect(selectorOf("provider/id:8080")).toBe("provider/id:8080");
	});

	it("matches suffix-insensitively and stays provider sensitive", () => {
		expect(sameModel(`${OPUS}:max`, OPUS)).toBe(true);
		expect(sameModel(OPUS, `${OPUS}:high`)).toBe(true);
		expect(sameModel("openai/claude-opus", OPUS)).toBe(false);
		expect(sameModel(SMOL, OPUS)).toBe(false);
		expect(sameModel("", OPUS)).toBe(false);
		expect(sameModel(OPUS, "")).toBe(false);
	});

	it("builds the new value from the level", () => {
		expect(withLevel(GPT, null)).toBe(GPT);
		expect(withLevel(GPT, "")).toBe(GPT);
		expect(withLevel(GPT, "xhigh")).toBe(`${GPT}:xhigh`);
		expect(THINKING_LEVELS).toContain("xhigh");
	});
});

describe("replaceValue", () => {
	it("replaces only the matching candidate of a comma list", () => {
		expect(replaceValue(`${OPUS}:high,${GPT}`, OPUS, SMOL)).toBe(`${SMOL},${GPT}`);
	});

	it("keeps untouched segments verbatim and writes the trimmed value in replaced ones", () => {
		expect(replaceValue(`${OPUS}, ${GPT}`, OPUS, SMOL)).toBe(`${SMOL}, ${GPT}`);
		expect(replaceValue(` ${OPUS} `, OPUS, SMOL)).toBe(SMOL);
	});

	it("replaces every matching candidate", () => {
		expect(replaceValue(`${OPUS},${OPUS}:low`, OPUS, SMOL)).toBe(`${SMOL},${SMOL}`);
	});

	it("returns null when nothing matches", () => {
		expect(replaceValue(GPT, OPUS, SMOL)).toBeNull();
		expect(replaceValue("openai/claude-opus", OPUS, SMOL)).toBeNull();
		expect(replaceValue("", OPUS, SMOL)).toBeNull();
	});

	it("never rewrites @role aliases and splits candidates like the backend", () => {
		expect(replaceValue("@smol", OPUS, SMOL)).toBeNull();
		expect(replaceValue(`${OPUS},@smol`, OPUS, SMOL)).toBe(`${SMOL},@smol`);
		expect(listCandidates(` a , ,b `)).toEqual(["a", "b"]);
	});
});

describe("full thinking-suffix grammar", () => {
	const FLASH = "agnes-free/agnes-3.0-flash";

	it("matches :off and :inherit candidates against the bare source", () => {
		expect(selectorOf(`${FLASH}:off`)).toBe(FLASH);
		expect(sameModel(`${FLASH}:off`, FLASH)).toBe(true);
		expect(sameModel(`${FLASH}:inherit`, FLASH)).toBe(true);
		expect(sameModel(FLASH, `${FLASH}:off`)).toBe(true);
	});

	it("replaces :off / :inherit items and writes the chosen level", () => {
		expect(replaceValue(`${FLASH}:off,${GPT}`, FLASH, withLevel(OPUS, "high"))).toBe(`${OPUS}:high,${GPT}`);
		expect(replaceValue(`${FLASH}:inherit`, FLASH, OPUS)).toBe(OPUS);
		expect(withLevel(OPUS, "off")).toBe(`${OPUS}:off`);
	});

	it("plans a replace for an :off role value and an :inherit chain item", () => {
		const plan = buildPlan({
			scan: scanOf([roleRef("default", `${FLASH}:off`)], { web: [`${FLASH}:inherit`] }),
			fromModel: FLASH,
			toModel: OPUS,
			level: "off",
		});
		expect(plan.rows.map((r) => r.after)).toEqual([`${OPUS}:off`, OPUS + ":off"]);
	});

	it("keeps inherit a known suffix but never offers it", () => {
		expect(THINKING_LEVELS).toContain("inherit");
		expect(levelsForSelector([kindEntry(OPUS, ["low", "high"])], OPUS)).not.toContain("inherit");
	});
});

const kindEntry = (selector: string, thinking: string[]): ModelKindEntry => ({
	selector,
	kind: "chat",
	provider: selector.slice(0, selector.indexOf("/")),
	name: null,
	thinking,
});

describe("catalog thinking levels", () => {
	const MIMO = "magpie/opencode-zen/mimo-v2.6-flash-free";
	const SONNET = "anthropic/claude-sonnet-5-5";
	const entries = [
		kindEntry(MIMO, ["minimal", "low", "medium", "high", "xhigh"]),
		kindEntry(SONNET, ["low", "medium", "high", "xhigh", "max"]),
		kindEntry("web/exa", []),
	];

	it("offers exactly what resolveThinkingLevels gives for the catalog entry", () => {
		expect(levelsForSelector(entries, MIMO)).toEqual(
			resolveThinkingLevels(undefined, ["minimal", "low", "medium", "high", "xhigh"], null),
		);
		expect(levelsForSelector(entries, MIMO)).not.toContain("max");
		expect(levelsForSelector(entries, SONNET)).toContain("max");
	});

	it("offers nothing for a model without thinking, an unknown model, no target or no catalog", () => {
		expect(levelsForSelector(entries, "web/exa")).toEqual([]);
		expect(levelsForSelector(entries, "nobody/unknown")).toEqual([]);
		expect(levelsForSelector(entries, "")).toEqual([]);
		expect(levelsForSelector(null, MIMO)).toEqual([]);
	});

	it("falls back to 模型默认 (null) for an unsupported level", () => {
		const mimo = levelsForSelector(entries, MIMO);
		expect(supportedLevel("max", mimo)).toBeNull();
		expect(supportedLevel("xhigh", mimo)).toBe("xhigh");
		expect(supportedLevel(null, mimo)).toBeNull();
		expect(supportedLevel("high", [])).toBeNull();
	});

	it("makes row override levels explicit and valid for the override's own target", () => {
		const out = sanitizeOverrides(
			{
				inherits: { model: MIMO },
				explicitBad: { model: MIMO, level: "max" },
				onSharedTarget: { level: "max" },
				noThinking: { model: "web/exa", level: "high" },
			},
			SONNET,
			"max",
			entries,
		);
		expect(out.inherits?.level).toBeNull();
		expect(out.explicitBad?.level).toBeNull();
		expect(out.onSharedTarget?.level).toBe("max");
		expect(out.noThinking?.level).toBeNull();
	});
});

describe("non-model sources", () => {
	it("never matches a bare role name or a glob as the source", () => {
		expect(sameModel("smol", "smol")).toBe(false);
		expect(sameModel("google-antigravity/*", "google-antigravity/*")).toBe(false);
		expect(sameModel("@smol", "@smol")).toBe(false);
		const plan = buildPlan({
			scan: scanOf([roleRef("default", "smol")], { smol: [OPUS], "google-antigravity/*": [GPT] }),
			fromModel: "smol",
			toModel: OPUS,
			level: null,
		});
		expect(plan.rows).toEqual([]);
	});
});

describe("labels", () => {
	it("names built-in roles and app settings in Chinese", () => {
		expect(roleTitle("default")).toBe("default · 主力模型");
		expect(roleTitle("custom-role")).toBe("custom-role");
		expect(appSettingLabel("newSessionModel")).toBe("新会话默认模型");
		expect(appSettingLabel("doctorModel")).toBe("诊断模型");
	});

	it("maps project paths to scanned names", () => {
		expect(projectNameMap([{ path: "/repo/alpha", name: "alpha", status: "ok", error: null }])).toEqual({
			"/repo/alpha": "alpha",
		});
	});
});

describe("isModelSelector", () => {
	it("accepts provider/id and rejects roles, aliases and globs", () => {
		expect(isModelSelector(OPUS)).toBe(true);
		expect(isModelSelector("web/exa")).toBe(true);
		for (const bad of ["smol", "web", "@smol", "google-antigravity/*", "a/b?", "a/[x]", ""]) {
			expect(isModelSelector(bad)).toBe(false);
		}
	});
});

describe("buildOverview", () => {
	const kinds = new Map([
		[OPUS, "chat"],
		[GPT, "chat"],
		["web/exa", "search"],
	]);

	it("groups values, chain keys and chain items by stripped selector", () => {
		const scan = scanOf(
			[roleRef("default", `${OPUS}:high,${GPT}`), appRef("doctorModel", OPUS), scheduleRef("s1", "日报", GPT, "low")],
			{ [OPUS]: [`${GPT}:max`, "@default"] },
		);
		const rows = buildOverview(scan, kinds);

		expect(rows.map((r) => r.selector)).toEqual([OPUS, GPT]);
		const opus = rows[0];
		expect(opus.count).toBe(3); // role, app setting, chain key
		expect(opus.levels).toEqual(["high"]);
		expect(opus.group).toBe("chat");
		// The alias is not a model and never shows up.
		expect(rows.some((r) => r.selector.includes("@"))).toBe(false);
		// Levels come from the stored values (`:max` on the chain item); a schedule's
		// thinking column is a separate field and does not mark the model.
		expect(rows[1]).toMatchObject({ count: 3, levels: ["max"] });
	});

	it("keeps every source with its scope", () => {
		const refs = [
			roleRef("default", OPUS),
			roleRef("fast", OPUS, "project"),
			overrideRef("worker", OPUS),
			appRef("sideChatModel", OPUS),
			scheduleRef("s1", "日报", OPUS),
			scheduleRef("s2", "周报", OPUS),
		];
		const [row] = buildOverview(scanOf(refs, { default: [OPUS] }), kinds);
		expect(row.count).toBe(7);
		expect(row.sources).toEqual([
			{ scope: "全局", title: "default · 主力模型" },
			{ scope: "alpha", title: "fast" },
			{ scope: "全局", title: "子代理 worker" },
			{ scope: "应用设置", title: "侧边对话专用模型" },
			{ scope: "定时任务", title: "日报" },
			{ scope: "定时任务", title: "周报" },
			{ scope: "回退链", title: "链 default" },
		]);
	});

	it("skips role names, aliases and globs", () => {
		const scan = scanOf([appRef("doctorModel", "smol"), roleRef("default", `@smol,${OPUS}`)], {
			web: [OPUS],
			"google-antigravity/*": [GPT],
			[GPT]: ["@default"],
		});
		expect(buildOverview(scan, kinds).map((r) => r.selector)).toEqual([OPUS, GPT]);
	});

	it("assigns groups from the kind map and flags missing only when it is loaded", () => {
		const scan = scanOf([roleRef("default", "gone/model"), roleRef("web", "web/exa"), roleRef("x", "img/one")]);
		const loaded = new Map([...kinds, ["img/one", "image"]]);
		const groups = Object.fromEntries(buildOverview(scan, loaded).map((r) => [r.selector, r.group]));
		expect(groups).toEqual({ "gone/model": "missing", "web/exa": "search", "img/one": "other" });
		// Not loaded (or failed): nothing is missing.
		expect(buildOverview(scan, null).some((r) => r.group === "missing")).toBe(false);
		expect(buildOverview(null, loaded)).toEqual([]);
	});
});

describe("buildPlan value rows", () => {
	it("groups rows and rewrites comma lists per candidate", () => {
		const scan = scanOf([
			roleRef("default", `${OPUS},${GPT}`),
			roleRef("fast", OPUS, "project"),
			overrideRef("worker", OPUS),
			appRef("sideChatModel", OPUS),
			scheduleRef("s1", "日报", OPUS, "low"),
		]);
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: SMOL, level: null });

		expect(plan.groups.map((g) => g.title)).toEqual(["全局", "每个项目", "应用设置", "定时任务"]);
		expect(plan.edits).toHaveLength(5);

		const [role, fast, override, app, schedule] = plan.rows;
		expect(role).toMatchObject({
			id: "role:global::default",
			group: "global",
			title: "default · 主力模型",
			context: "全局",
			before: `${OPUS},${GPT}`,
			after: `${SMOL},${GPT}`,
			checked: true,
		});
		expect(fast).toMatchObject({ group: "project", context: "alpha" });
		expect(override.title).toBe("子代理 worker");
		expect(app).toMatchObject({ group: "appSetting", title: "侧边对话专用模型" });
		// Schedules keep the bare selector in the model column; the row shows the
		// resulting model + thinking pair.
		expect(schedule).toMatchObject({
			group: "schedule",
			context: "定时任务",
			before: `${OPUS}:low`,
			after: `${SMOL}:low`,
		});
		expect(schedule.edit).toEqual({
			kind: "value",
			location: { kind: "schedule", id: "s1", name: "日报" },
			before: OPUS,
			after: SMOL,
			// No level chosen: the thinking column stays as it was.
			thinkingBefore: "low",
			thinkingAfter: "low",
		});
	});

	it("appends the chosen level and sends it to the schedule thinking column", () => {
		const plan = buildPlan({
			scan: scanOf([roleRef("default", OPUS), scheduleRef("s1", "日报", OPUS, null)]),
			fromModel: OPUS,
			toModel: GPT,
			level: "high",
		});
		expect(plan.rows[0].after).toBe(`${GPT}:high`);
		expect(plan.rows[1].after).toBe(`${GPT}:high`);
		expect(plan.rows[1].edit).toMatchObject({
			kind: "value",
			after: GPT,
			thinkingBefore: null,
			thinkingAfter: "high",
		});
	});

	it("applies a per-row override of model and level", () => {
		const scan = scanOf([roleRef("default", OPUS), roleRef("fast", OPUS)]);
		const plan = buildPlan({
			scan,
			fromModel: OPUS,
			toModel: GPT,
			level: "low",
			overrides: { "role:global::fast": { model: "google/gemini", level: null } },
		});
		expect(plan.rows[0]).toMatchObject({ model: GPT, level: "low", after: `${GPT}:low` });
		expect(plan.rows[1]).toMatchObject({ model: "google/gemini", level: null, after: "google/gemini" });
	});

	it("skips rows that do not match, honours checkboxes and lists skipped projects", () => {
		const scan = scanOf(
			[roleRef("default", "openai/claude-opus"), roleRef("fast", OPUS)],
			{},
			{
				projects: [
					{ path: "/repo/alpha", name: "alpha", status: "ok", error: null },
					{ path: "/repo/beta", name: "beta", status: "missing", error: null },
					{ path: "/repo/gamma", name: "gamma", status: "error", error: "权限不足" },
				],
			},
		);
		const plan = buildPlan({
			scan,
			fromModel: OPUS,
			toModel: SMOL,
			level: null,
			checked: { "role:global::fast": false },
		});
		expect(plan.rows.map((r) => r.id)).toEqual(["role:global::fast"]);
		expect(plan.rows[0].checked).toBe(false);
		expect(plan.edits).toEqual([]);
		expect(plan.skippedProjects).toEqual([
			{ name: "beta", path: "/repo/beta", reason: "目录不存在" },
			{ name: "gamma", path: "/repo/gamma", reason: "权限不足" },
		]);
	});

	it("lists a failed global config read (which arrives as a project entry) with its reason", () => {
		const plan = buildPlan({
			scan: scanOf([roleRef("default", OPUS)], {}, {
				projects: [
					{ path: "/home/u/.omp/agent/config.yml", name: "全局配置", status: "error", error: "第 3 行 YAML 解析失败" },
					{ path: "/repo/alpha", name: "alpha", status: "ok", error: null },
				],
			}),
			fromModel: OPUS,
			toModel: SMOL,
			level: null,
		});
		expect(plan.skippedProjects).toEqual([
			{ name: "全局配置", path: "/home/u/.omp/agent/config.yml", reason: "第 3 行 YAML 解析失败" },
		]);
	});
});

describe("buildPlan fallback chains", () => {
	it("replaces items and dedupes, keeping the key", () => {
		const scan = scanOf([], { default: [`${OPUS}:high`, OPUS, "@smol"] });
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: SMOL, level: null });

		expect(plan.rows).toHaveLength(1);
		const row = plan.rows[0];
		expect(row).toMatchObject({
			id: "chain:default",
			group: "chain",
			title: "default",
			context: "回退链条目",
			before: `${OPUS}:high, ${OPUS}, @smol`,
			after: `${SMOL}, @smol`,
			checked: true,
			renamedKey: null,
			conflict: false,
			deduped: true,
		});
		expect(row.edit).toEqual({
			kind: "fallbackChain",
			label: "default",
			changes: [{ key: "default", before: [`${OPUS}:high`, OPUS, "@smol"], after: [SMOL, "@smol"] }],
		});
	});

	it("drops items equal to the chain's own key and untouched chains", () => {
		const plan = buildPlan({
			scan: scanOf([], { default: [`${OPUS}:high`, "default"], other: ["@smol"] }),
			fromModel: OPUS,
			toModel: "default",
			level: null,
		});
		expect(plan.rows).toHaveLength(1);
		expect(chainChanges(plan.rows[0].edit)).toEqual([
			{ key: "default", before: [`${OPUS}:high`, "default"], after: [] },
		]);
	});

	it("renames a key equal to X and deletes the old key", () => {
		const scan = scanOf([], { [OPUS]: [GPT, SMOL] });

		const before = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null }).rows[0];
		// GPT is the target: X's items are replaced first, then the key is renamed.
		expect(before).toMatchObject({
			context: "回退链键 → openai/gpt-5",
			before: `${OPUS}: openai/gpt-5, smol`,
			after: "openai/gpt-5: smol",
			conflict: false,
			checked: true,
			renamedKey: GPT,
			deduped: true,
		});
		expect(before.edit).toEqual({
			kind: "fallbackChain",
			label: OPUS,
			changes: [
				{ key: GPT, before: null, after: [SMOL] },
				{ key: OPUS, before: [GPT, SMOL], after: null },
			],
		});
	});

	it("renames the key to the bare target even when a level is chosen", () => {
		const scan = scanOf([], { [OPUS]: [SMOL], default: [OPUS] });
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: "high" });
		expect(chainChanges(plan.rows.find((r) => r.title === OPUS)?.edit ?? null)).toEqual([
			{ key: GPT, before: null, after: [SMOL] },
			{ key: OPUS, before: [SMOL], after: null },
		]);
		// Items carry the level; keys never do.
		expect(chainChanges(plan.rows.find((r) => r.title === "default")?.edit ?? null)).toEqual([
			{ key: "default", before: [OPUS], after: [`${GPT}:high`] },
		]);
	});

	it("marks a conflicting rename, unchecked by default and merged once checked", () => {
		const scan = scanOf([], { [OPUS]: [SMOL], [GPT]: [SMOL, "haiku"] });

		const unchecked = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null }).rows[0];
		expect(unchecked).toMatchObject({
			context: `回退链键 → ${GPT}（已存在）`,
			conflict: true,
			checked: false,
			edit: null,
			deduped: true,
		});
		expect(buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null }).edits).toEqual([]);

		const checked = buildPlan({
			scan,
			fromModel: OPUS,
			toModel: GPT,
			level: null,
			checked: { [`chain:${OPUS}`]: true },
		}).rows[0];
		expect(checked.edit).toEqual({
			kind: "fallbackChain",
			label: OPUS,
			changes: [
				{ key: GPT, before: [SMOL, "haiku"], after: [SMOL, "haiku"] },
				{ key: OPUS, before: [SMOL], after: null },
			],
		});
	});

	it("surfaces a chain read error and keeps chain rows empty", () => {
		const plan = buildPlan({
			scan: scanOf([roleRef("default", OPUS)], {}, { fallbackChainsError: "omp 不可用" }),
			fromModel: OPUS,
			toModel: SMOL,
			level: null,
		});
		expect(plan.chainError).toBe("omp 不可用");
		expect(plan.rows.map((r) => r.group)).toEqual(["global"]);
	});

	it("returns no rows when nothing references the source model", () => {
		const plan = buildPlan({
			scan: scanOf([roleRef("default", GPT)], { default: ["@smol"] }),
			fromModel: OPUS,
			toModel: SMOL,
			level: null,
		});
		expect(plan.rows).toEqual([]);
		expect(plan.groups).toEqual([]);
		expect(plan.edits).toEqual([]);
	});
});

describe("results merging and undo display", () => {
	const valueEdit = (name: string, before: string, after: string): ModelReplaceEdit => ({
		kind: "value",
		location: { kind: "role", scope: "global", projectPath: null, name },
		before,
		after,
		thinkingBefore: null,
		thinkingAfter: null,
	});
	const chainEdit = (label: string, changes: ChainChange[]): ModelReplaceEdit => ({
		kind: "fallbackChain",
		label,
		changes,
	});

	it("keeps a stable identity per edit", () => {
		expect(editKey(valueEdit("default", OPUS, SMOL))).toBe(editKey(valueEdit("default", SMOL, GPT)));
		expect(editKey(valueEdit("default", OPUS, SMOL))).not.toBe(editKey(valueEdit("fast", OPUS, SMOL)));
		expect(editKey(chainEdit("default", [{ key: "default", before: null, after: [] }]))).toBe("chain:default:default");
		expect(editKey({ kind: "value", location: { kind: "appSetting", field: "doctorModel" }, before: OPUS, after: SMOL, thinkingBefore: null, thinkingAfter: null })).toBe(
			"value:appSetting:doctorModel",
		);
	});

	it("folds a retry into the previous results in place", () => {
		const a = valueEdit("default", OPUS, SMOL);
		const b = valueEdit("fast", OPUS, SMOL);
		const c = chainEdit("default", [{ key: "default", before: [OPUS], after: [SMOL] }]);
		const previous: ModelReplaceItemResult[] = [
			{ edit: a, ok: true, error: null },
			{ edit: b, ok: false, error: "旧失败" },
		];
		const merged = mergeResults(previous, [
			{ edit: b, ok: true, error: null },
			{ edit: c, ok: false, error: "回退链写入失败" },
		]);
		expect(merged.map((r) => [r.ok, r.error])).toEqual([
			[true, null],
			[true, null],
			[false, "回退链写入失败"],
		]);
		expect(merged[0]).toBe(previous[0]);
	});

	it("inverts value and chain edits for display", () => {
		expect(
			invertEdit({
				kind: "value",
				location: { kind: "schedule", id: "s1", name: "日报" },
				before: OPUS,
				after: SMOL,
				thinkingBefore: null,
				thinkingAfter: "high",
			}),
		).toEqual({
			kind: "value",
			location: { kind: "schedule", id: "s1", name: "日报" },
			before: SMOL,
			after: OPUS,
			thinkingBefore: "high",
			thinkingAfter: null,
		});
		expect(invertEdit(chainEdit(OPUS, [{ key: GPT, before: null, after: [SMOL] }]))).toEqual(
			chainEdit(OPUS, [{ key: GPT, before: [SMOL], after: null }]),
		);
	});

	it("shows the schedule level an undo restores", () => {
		const applied: ModelReplaceEdit = {
			kind: "value",
			location: { kind: "schedule", id: "s1", name: "日报" },
			before: OPUS,
			after: SMOL,
			thinkingBefore: "low",
			thinkingAfter: null,
		};
		// Undo swaps the columns back, so the history row names the level that returns.
		expect(summarizeEdit(invertEdit(applied))).toMatchObject({
			before: SMOL,
			after: `${OPUS}:low`,
			details: ["思考等级: 未设置 → low"],
		});
	});

	it("summarizes edits for the results and history lists", () => {
		const names = projectNameMap([{ path: "/repo/alpha", name: "alpha", status: "ok", error: null }]);
		expect(
			summarizeEdit(
				{
					kind: "value",
					location: { kind: "role", scope: "project", projectPath: "/repo/alpha", name: "fast" },
					before: OPUS,
					after: SMOL,
					thinkingBefore: null,
					thinkingAfter: null,
				},
				names,
			),
		).toEqual({ title: "fast", context: "alpha", before: OPUS, after: SMOL, details: [] });

		expect(
			summarizeEdit(
				{
					kind: "value",
					location: { kind: "schedule", id: "s1", name: "日报" },
					before: OPUS,
					after: SMOL,
					thinkingBefore: null,
					thinkingAfter: "high",
				},
				names,
			),
		).toMatchObject({
			title: "日报",
			context: "定时任务",
			// The model column and the thinking column render as the pair the row holds.
			before: OPUS,
			after: `${SMOL}:high`,
			details: ["思考等级: 未设置 → high"],
		});

		expect(
			summarizeEdit(
				chainEdit(OPUS, [
					{ key: GPT, before: null, after: [SMOL] },
					{ key: OPUS, before: [GPT, SMOL], after: null },
				]),
				names,
			),
		).toEqual({
			title: OPUS,
			context: "回退链",
			before: "（不存在）",
			after: "smol",
			details: ["openai/gpt-5: （不存在） → smol", `anthropic/claude-opus: openai/gpt-5, smol → （不存在）`],
		});
	});
});

describe("liveSessionsOnModel", () => {
	const models = [
		{ provider: "anthropic", id: "claude-opus", name: "opus" },
		{ provider: "openai", id: "claude-opus", name: "opus" },
	];

	it("lists sessions whose resolved model is the source model", () => {
		const rows = liveSessionsOnModel(
			[
				{ sessionId: "a", title: "A", cwd: "/repo/alpha", modelState: { provider: "anthropic", modelId: "claude-opus" } },
				{ sessionId: "b", title: "B", cwd: null, modelState: "anthropic/claude-opus:high" },
				{ sessionId: "c", title: "C", cwd: null, modelState: { provider: "openai", modelId: "claude-opus" } },
				{ sessionId: "d", title: "D", cwd: null, modelState: null },
			],
			models,
			"anthropic/claude-opus",
		);
		expect(rows.map((r) => [r.sessionId, r.value])).toEqual([
			["a", "anthropic/claude-opus"],
			// The resolved value keeps the level suffix; matching ignores it.
			["b", "anthropic/claude-opus:high"],
		]);
	});

	it("returns nothing without a target", () => {
		expect(liveSessionsOnModel([{ sessionId: "a", title: "A", cwd: null, modelState: "anthropic/claude-opus" }], models, "")).toEqual([]);
	});
});

describe("replace scope", () => {
	const betaRef = (name: string, value: string): ModelUsageRef => ({
		location: { kind: "role", scope: "project", projectPath: "/repo/beta", name },
		value,
		thinking: null,
	});
	const scan = scanOf(
		[
			roleRef("default", OPUS),
			roleRef("smol", OPUS, "project"),
			betaRef("plan", OPUS),
			appRef("doctorModel", OPUS),
			scheduleRef("s1", "nightly", OPUS),
		],
		{ default: [OPUS, GPT] },
	);

	it("lists 全部, 全局 and only projects that hold model references", () => {
		const options = scopeOptions(scanOf([roleRef("default", OPUS), roleRef("smol", OPUS, "project"), betaRef("plan", "smol")]));
		expect(options.map((o) => o.value)).toEqual(["all", "global", "project:/repo/alpha"]);
		expect(options[2]?.label).toBe("项目：alpha");
	});

	it("plans only the chosen project's locations (no chains, settings or schedules)", () => {
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null, scope: "project:/repo/alpha" });
		expect(plan.rows.map((r) => r.id)).toEqual(["role:project:/repo/alpha:smol"]);
		expect(plan.edits).toHaveLength(1);
	});

	it("global scope covers global config, chains, settings and schedules but no project", () => {
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null, scope: "global" });
		expect(plan.rows.map((r) => r.group).sort()).toEqual(["appSetting", "chain", "global", "schedule"]);
	});

	it("scope all plans everything", () => {
		const plan = buildPlan({ scan, fromModel: OPUS, toModel: GPT, level: null });
		expect(plan.rows).toHaveLength(6);
	});

	it("scopes the overview counts and sources", () => {
		const rows = buildOverview(scan, null, "project:/repo/beta");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.count).toBe(1);
		expect(rows[0]?.sources.map((s) => s.scope)).toEqual(["beta"]);
	});

	it("labels the scope a recorded replacement touched", () => {
		const names = { "/repo/alpha": "alpha", "/repo/beta": "beta" };
		const edit = (location: Extract<ModelReplaceEdit, { kind: "value" }>["location"]): ModelReplaceEdit => ({
			kind: "value",
			location,
			before: OPUS,
			after: GPT,
			thinkingBefore: null,
			thinkingAfter: null,
		});
		const global = edit({ kind: "role", scope: "global", projectPath: null, name: "default" });
		const alpha = edit({ kind: "role", scope: "project", projectPath: "/repo/alpha", name: "smol" });
		const beta = edit({ kind: "role", scope: "project", projectPath: "/repo/beta", name: "plan" });
		expect(editsScopeLabel([global], names)).toBe("全局");
		expect(editsScopeLabel([alpha], names)).toBe("项目：alpha");
		expect(editsScopeLabel([alpha, beta], names)).toBe("2 个项目");
		expect(editsScopeLabel([global, alpha], names)).toBe("全局 + 项目：alpha");
	});
});

describe("overview search", () => {
	const scan = scanOf([roleRef("default", OPUS), roleRef("smol", GPT, "project"), appRef("doctorModel", GPT)]);
	let rows: OverviewRow[];
	beforeEach(() => {
		rows = buildOverview(scan, null);
	});

	it("keeps everything for a blank query", () => {
		expect(filterOverviewRows(rows, "   ")).toEqual(rows);
	});

	it("matches model id and provider case-insensitively", () => {
		expect(filterOverviewRows(rows, "OPENAI").map((r) => r.selector)).toEqual([GPT]);
		expect(filterOverviewRows(rows, "claude").map((r) => r.selector)).toEqual([OPUS]);
	});

	it("matches location text and requires every term", () => {
		expect(filterOverviewRows(rows, "主力模型").map((r) => r.selector)).toEqual([OPUS]);
		expect(filterOverviewRows(rows, "alpha").map((r) => r.selector)).toEqual([GPT]);
		expect(filterOverviewRows(rows, "gpt 诊断").map((r) => r.selector)).toEqual([GPT]);
		expect(filterOverviewRows(rows, "gpt 主力模型")).toEqual([]);
	});

	it("highlights every case-insensitive occurrence", () => {
		expect(highlightParts("Open/open-ai", ["open"])).toEqual([
			{ text: "Open", match: true },
			{ text: "/", match: false },
			{ text: "open", match: true },
			{ text: "-ai", match: false },
		]);
		expect(highlightParts("abc", [])).toEqual([{ text: "abc", match: false }]);
	});

	it("finds the location a term matches", () => {
		const sources = [{ scope: "全局", title: "default · 主力模型" }, { scope: "alpha", title: "smol" }];
		expect(sources.find((s) => sourceMatches(s, searchTerms("ALPHA")))).toBe(sources[1]);
	});
});
