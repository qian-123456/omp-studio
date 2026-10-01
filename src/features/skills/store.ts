import { create } from "zustand";
import type {
	OmpConfigListResult,
	SkillItem,
	SkillProvider,
	SkillUsage,
	SkillUsageReport,
	SkillsCatalog,
} from "../../lib/contracts";
import {
	ompConfigList,
	ompConfigSet,
	skillsList,
	skillsTrash,
	skillsUsage,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";

/** Suggested resident system-prompt budget for skill name+description entries. */
export const SKILL_BUDGET_CHARS = 15_000;

/** Usage scan window surfaced in the UI (触发列标题、吃灰统计). */
export const USAGE_DAYS = 45;

export type SkillSourceFilter = "all" | "user" | "project";
export type SkillStatusFilter = "all" | "active" | "idle" | "issues" | "disabled";
export type SkillSort = "count" | "lastUsed" | "name";

/** The detail drawer overlays the page; `path` identifies the target item. */
export interface SkillsDrawerTarget {
	kind: "skill" | "extension";
	path: string;
}

export interface SkillsState {
	catalog: SkillsCatalog | null;
	loading: boolean;
	error: string | null;
	activeTab: "skills" | "extensions";
	searchQuery: string;
	sourceFilter: SkillSourceFilter;
	statusFilter: SkillStatusFilter;
	sort: SkillSort;
	drawer: SkillsDrawerTarget | null;
	/** OMP config slice deciding per-skill enablement (skills.* + disabledExtensions). */
	skillConfig: SkillEnableConfig;
	/** Dirs currently being trashed (in-flight guard). */
	trashingDirs: string[];
	/** Trigger stats keyed by skill name. */
	usage: Record<string, SkillUsage>;
	usageReport: SkillUsageReport | null;
	usageLoading: boolean;
	/** Non-null when the usage scan failed (backend missing/errored). */
	usageError: string | null;
	usageLoaded: boolean;
	lastLoadedCwd: string | null | undefined;

	loadCatalog: (cwd?: string | null, force?: boolean) => Promise<void>;
	loadUsage: (force?: boolean) => Promise<void>;
	refresh: (cwd?: string | null) => Promise<void>;
	setActiveTab: (tab: "skills" | "extensions") => void;
	setSearchQuery: (query: string) => void;
	setSourceFilter: (filter: SkillSourceFilter) => void;
	setStatusFilter: (filter: SkillStatusFilter) => void;
	setSort: (sort: SkillSort) => void;
	openDrawer: (target: SkillsDrawerTarget) => void;
	closeDrawer: () => void;
	updateExtensionEnabled: (path: string, enabled: boolean) => void;
	/** Toggle a skill via disabledExtensions (+ exact ignoredSkills removal on enable). */
	setSkillEnabled: (skill: SkillItem, enabled: boolean) => Promise<void>;
	/** Move a skill directory to the OS Trash, then refresh the catalog. */
	trashSkill: (skill: SkillItem, cwd?: string | null) => Promise<void>;
}

export interface SkillStats {
	total: number;
	userCount: number;
	projectCount: number;
	/** count > 0 within the scanned window. */
	active: number;
	totalTriggers: number;
	/** count === 0 (or no recorded usage at all). */
	idle: number;
	/** issues.length > 0. */
	withIssues: number;
	missingDescription: number;
	tooLong: number;
	unreadable: number;
	/** Sum of promptChars across all skills — resident context cost estimate. */
	budgetUsed: number;
	/** Skills filtered out of new sessions by config (any reason). */
	disabled: number;
}


// ---- Skill enablement (OMP config filter pipeline) ----

/** The OMP config slice that decides whether a skill reaches new sessions. */
export interface SkillEnableConfig {
	/** `skills.enabled` master switch (default true). */
	skillsEnabled: boolean;
	/** `skills.enable*` source toggles, keyed by full config key. */
	sourceToggles: Record<string, boolean>;
	/** `skills.ignoredSkills` glob list. */
	ignored: string[];
	/** `skills.includeSkills` allowlist (empty = include everything). */
	include: string[];
	/** `disabledExtensions` entries (`skill:<name>` marks a disabled skill). */
	disabledExtensions: string[];
}

export const DEFAULT_SKILL_CONFIG: SkillEnableConfig = {
	skillsEnabled: true,
	sourceToggles: {},
	ignored: [],
	include: [],
	disabledExtensions: [],
};

/** Why a skill won't reach a new session. Order matches the filter pipeline. */
export type SkillDisabledReason =
	| { kind: "disabled" } // disabledExtensions contains skill:<name>
	| { kind: "source"; key: string } // its source toggle is off
	| { kind: "ignored"; pattern: string; exact: boolean } // ignoredSkills match
	| { kind: "not_included" } // includeSkills non-empty and no match
	| { kind: "all_off" }; // skills.enabled = false

export interface SkillEnablement {
	enabled: boolean;
	reason: SkillDisabledReason | null;
}

/** `(provider, source)` → the OMP `skills.enable*` key gating that root. */
const PROVIDER_SOURCE_TOGGLE: Record<SkillProvider, Record<string, string>> = {
	native: { user: "skills.enablePiUser", project: "skills.enablePiProject" },
	claude: {
		user: "skills.enableClaudeUser",
		project: "skills.enableClaudeProject",
	},
	agents: {
		user: "skills.enableAgentsUser",
		project: "skills.enableAgentsProject",
	},
	codex: { user: "skills.enableCodexUser" },
	github: {},
	managed: {},
};

/** Anchored single-segment glob (`*`, `?`; `**` ≡ `*`), case-sensitive. */
export function skillGlobMatch(pattern: string, name: string): boolean {
	const re = new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*+/g, ".*")
			.replace(/\?/g, ".")}$`,
	);
	return re.test(name);
}

/** Reads `omp config list` output into the slice needed for enablement. */
export function parseSkillConfig(list: OmpConfigListResult): SkillEnableConfig {
	const cfg: SkillEnableConfig = { ...DEFAULT_SKILL_CONFIG, sourceToggles: {} };
	for (const entry of list.entries) {
		const strList = () =>
			Array.isArray(entry.value)
				? entry.value.filter((v): v is string => typeof v === "string")
				: [];
		switch (entry.key) {
			case "skills.enabled":
				if (typeof entry.value === "boolean") cfg.skillsEnabled = entry.value;
				break;
			case "skills.ignoredSkills":
				cfg.ignored = strList();
				break;
			case "skills.includeSkills":
				cfg.include = strList();
				break;
			case "disabledExtensions":
				cfg.disabledExtensions = strList();
				break;
			default:
				if (
					entry.key.startsWith("skills.enable") &&
					typeof entry.value === "boolean"
				) {
					cfg.sourceToggles[entry.key] = entry.value;
				}
		}
	}
	return cfg;
}

/**
 * Applies OMP's session-start filter pipeline to one skill:
 * skills.enabled → disabledExtensions `skill:<name>` → source toggle →
 * ignoredSkills globs → includeSkills allowlist. Exported for tests.
 */
export function resolveSkillEnablement(
	skill: SkillItem,
	cfg: SkillEnableConfig,
): SkillEnablement {
	const deny = (reason: SkillDisabledReason): SkillEnablement => ({
		enabled: false,
		reason,
	});
	if (!cfg.skillsEnabled) return deny({ kind: "all_off" });
	if (cfg.disabledExtensions.includes(`skill:${skill.name}`))
		return deny({ kind: "disabled" });
	const key = PROVIDER_SOURCE_TOGGLE[skill.provider]?.[skill.source];
	if (key && cfg.sourceToggles[key] === false)
		return deny({ kind: "source", key });
	const exact = cfg.ignored.some((p) => p === skill.name);
	const globbed = cfg.ignored.find((p) => skillGlobMatch(p, skill.name));
	if (exact) return deny({ kind: "ignored", pattern: skill.name, exact: true });
	if (globbed) return deny({ kind: "ignored", pattern: globbed, exact: false });
	if (cfg.include.length > 0 && !cfg.include.some((p) => skillGlobMatch(p, skill.name)))
		return deny({ kind: "not_included" });
	return { enabled: true, reason: null };
}

/**
 * Read-modify-write helper for OMP config keys holding string lists.
 * `mutate` returns the next array; returning the same array skips the write.
 */
export async function updateOmpListSetting(
	key: string,
	mutate: (current: string[]) => string[],
): Promise<void> {
	const list = await ompConfigList();
	const entry = list.entries.find((e) => e.key === key);
	const current =
		entry && Array.isArray(entry.value)
			? entry.value.filter((v): v is string => typeof v === "string")
			: [];
	const next = mutate(current);
	if (next === current) return;
	await ompConfigSet(key, JSON.stringify(next));
}
/** Pure stats used by the stat cards + budget meter; exported for tests. */
export function computeSkillStats(
	skills: SkillItem[],
	usage: Record<string, SkillUsage>,
	cfg: SkillEnableConfig = DEFAULT_SKILL_CONFIG,
): SkillStats {
	const stats: SkillStats = {
		total: skills.length,
		userCount: 0,
		projectCount: 0,
		active: 0,
		totalTriggers: 0,
		idle: 0,
		withIssues: 0,
		missingDescription: 0,
		tooLong: 0,
		unreadable: 0,
		budgetUsed: 0,
		disabled: 0,
	};
	for (const s of skills) {
		if (s.source === "project") stats.projectCount++;
		else if (s.source === "user") stats.userCount++;
		// Disabled skills never reach the system prompt — excluded from budget.
		if (resolveSkillEnablement(s, cfg).enabled) {
			stats.budgetUsed += s.promptChars;
		} else {
			stats.disabled++;
		}
		const issues = s.issues;
		if (issues.length > 0) {
			stats.withIssues++;
			if (issues.includes("missing_description")) stats.missingDescription++;
			if (issues.includes("description_too_long")) stats.tooLong++;
			if (issues.includes("unreadable")) stats.unreadable++;
		}
		const count = usage[s.name]?.count ?? 0;
		if (count > 0) {
			stats.active++;
			stats.totalTriggers += count;
		} else {
			stats.idle++;
		}
	}
	return stats;
}

/** Pure filter + search + sort for the skills table; exported for tests. */
export function selectVisibleSkills(
	state: Pick<
		SkillsState,
		"catalog" | "searchQuery" | "sourceFilter" | "statusFilter" | "sort" | "usage" | "skillConfig"
	>,
): SkillItem[] {
	const skills = state.catalog?.skills ?? [];
	const q = state.searchQuery.trim().toLowerCase();
	const usage = state.usage;
	const filtered = skills.filter((s) => {
		if (state.sourceFilter === "user" && s.source !== "user") return false;
		if (state.sourceFilter === "project" && s.source !== "project") return false;
		if (state.statusFilter === "active" && (usage[s.name]?.count ?? 0) <= 0)
			return false;
		if (state.statusFilter === "idle" && (usage[s.name]?.count ?? 0) > 0)
			return false;
		if (state.statusFilter === "issues" && (s.issues?.length ?? 0) === 0)
			return false;
		if (
			state.statusFilter === "disabled" &&
			resolveSkillEnablement(s, state.skillConfig).enabled
		)
			return false;
		if (!q) return true;
		return (
			s.name.toLowerCase().includes(q) ||
			(s.description ?? "").toLowerCase().includes(q) ||
			(s.root ?? "").toLowerCase().includes(q)
		);
	});

	const byName = (a: SkillItem, b: SkillItem) => a.name.localeCompare(b.name);
	const sorted = [...filtered];
	switch (state.sort) {
		case "name":
			sorted.sort(byName);
			break;
		case "count":
			sorted.sort(
				(a, b) =>
					(usage[b.name]?.count ?? 0) - (usage[a.name]?.count ?? 0) ||
					byName(a, b),
			);
			break;
		case "lastUsed":
			sorted.sort((a, b) => {
				const ta = usage[a.name]?.lastUsedAt ?? null;
				const tb = usage[b.name]?.lastUsedAt ?? null;
				if (ta === null && tb === null) return byName(a, b);
				if (ta === null) return 1; // never triggered → last
				if (tb === null) return -1;
				return tb.localeCompare(ta) || byName(a, b);
			});
			break;
	}
	return sorted;
}

/** Guards `loadUsage` against concurrent invocations (single-flight). */
let usageInflight: Promise<void> | null = null;

export const useSkillsStore = create<SkillsState>((set, get) => ({
	catalog: null,
	loading: false,
	error: null,
	activeTab: "skills",
	searchQuery: "",
	sourceFilter: "all",
	statusFilter: "all",
	sort: "count",
	drawer: null,
	usage: {},
	usageReport: null,
	usageLoading: false,
	usageError: null,
	usageLoaded: false,
	lastLoadedCwd: undefined,
	skillConfig: DEFAULT_SKILL_CONFIG,
	trashingDirs: [],

	loadCatalog: async (cwd, force = false) => {
		const state = get();
		// Caching: do not refetch if already loaded for the same cwd unless force is true
		if (state.catalog && !force && state.lastLoadedCwd === cwd) {
			return;
		}

		set({ loading: true, error: null });
		try {
			const [catalog, configList] = await Promise.all([
				skillsList(cwd),
				// Config fetch failure must not block the catalog — fall back to
				// the all-enabled defaults.
				Promise.resolve()
					.then(() => ompConfigList())
					.catch(() => null),
			]);
			const skillConfig = configList
				? parseSkillConfig(configList)
				: DEFAULT_SKILL_CONFIG;
			set((s) => ({
				skillConfig,
				catalog,
				loading: false,
				error: null,
				lastLoadedCwd: cwd,
				// Close the drawer when its target disappeared after a reload.
				drawer:
					s.drawer &&
					(s.drawer.kind === "skill"
						? catalog.skills.some((sk) => sk.path === s.drawer?.path)
						: catalog.extensions.some(
								(ex) => ex.path === s.drawer?.path,
							))
						? s.drawer
						: null,
			}));
		} catch (err) {
			set({
				loading: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	},

	loadUsage: (force = false) => {
		const state = get();
		if (usageInflight) return usageInflight;
		if (state.usageLoaded && !force) return Promise.resolve();

		set({ usageLoading: true });
		usageInflight = skillsUsage(USAGE_DAYS)
			.then((report) => {
				const usage: Record<string, SkillUsage> = {};
				for (const u of report.usage) usage[u.name] = u;
				set({
					usage,
					usageReport: report,
					usageLoading: false,
					usageError: null,
					usageLoaded: true,
				});
			})
			.catch((err: unknown) => {
				set({
					usageLoading: false,
					usageError: err instanceof Error ? err.message : String(err),
				});
			})
			.finally(() => {
				usageInflight = null;
			});
		return usageInflight;
	},

	refresh: async (cwd) => {
		await Promise.all([
			get().loadCatalog(cwd, true),
			get().loadUsage(true),
		]);
	},

	setActiveTab: (tab) => set({ activeTab: tab }),

	setSearchQuery: (query) => set({ searchQuery: query }),

	setSourceFilter: (filter) => set({ sourceFilter: filter }),

	setStatusFilter: (filter) => set({ statusFilter: filter }),

	setSort: (sort) => set({ sort }),

	openDrawer: (target) => set({ drawer: target }),

	closeDrawer: () => set({ drawer: null }),

	updateExtensionEnabled: (path, enabled) => {
		set((s) => {
			if (!s.catalog) return s;
			const updatedExtensions = s.catalog.extensions.map((ext) =>
				ext.path === path ? { ...ext, enabled } : ext,
			);
			return {
				catalog: {
					...s.catalog,
					extensions: updatedExtensions,
				},
			};
		});
	},

	setSkillEnabled: async (skill, enabled) => {
		const prev = get().skillConfig;
		const marker = `skill:${skill.name}`;
		// Re-enabling also clears an exact-name ignoredSkills entry so the
		// skill is actually live (glob matches stay — switch is locked for them).
		const clearExactIgnored = enabled && prev.ignored.includes(skill.name);

		// Optimistic: reflect the write immediately, roll back on failure.
		set({
			skillConfig: {
				...prev,
				disabledExtensions: enabled
					? prev.disabledExtensions.filter((e) => e !== marker)
					: [...new Set([...prev.disabledExtensions, marker])],
				ignored: clearExactIgnored
					? prev.ignored.filter((p) => p !== skill.name)
					: prev.ignored,
			},
		});
		try {
			const writes: Promise<void>[] = [
				updateOmpListSetting("disabledExtensions", (cur) =>
					enabled
						? cur.filter((e) => e !== marker)
						: [...new Set([...cur, marker])],
				),
			];
			if (clearExactIgnored) {
				writes.push(
					updateOmpListSetting("skills.ignoredSkills", (cur) =>
						cur.filter((p) => p !== skill.name),
					),
				);
			}
			await Promise.all(writes);
			toast.success(
				enabled
					? `已启用 ${skill.name}，新会话生效`
					: `已停用 ${skill.name}，新会话生效`,
			);
		} catch (err) {
			set({ skillConfig: prev });
			toast.error(
				`更新技能状态失败: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	},

	trashSkill: async (skill, cwd) => {
		if (get().trashingDirs.includes(skill.dir)) return;
		set((s) => ({ trashingDirs: [...s.trashingDirs, skill.dir] }));
		try {
			await skillsTrash(skill.dir);
			toast.success(`已将「${skill.name}」移到废纸篓`);
			get().closeDrawer();
			await get().loadCatalog(cwd, true);
		} catch (err) {
			toast.error(
				`移到废纸篓失败: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			set((s) => ({
				trashingDirs: s.trashingDirs.filter((d) => d !== skill.dir),
			}));
		}
	},
}));
