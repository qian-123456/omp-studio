import { create } from "zustand";
import type {
	SkillItem,
	SkillUsage,
	SkillUsageReport,
	SkillsCatalog,
} from "../../lib/contracts";
import { skillsList, skillsUsage } from "../../lib/ipc";

/** Suggested resident system-prompt budget for skill name+description entries. */
export const SKILL_BUDGET_CHARS = 15_000;

/** Usage scan window surfaced in the UI (触发列标题、吃灰统计). */
export const USAGE_DAYS = 45;

export type SkillSourceFilter = "all" | "user" | "project";
export type SkillStatusFilter = "all" | "active" | "idle" | "issues";
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
}

/** Pure stats used by the stat cards + budget meter; exported for tests. */
export function computeSkillStats(
	skills: SkillItem[],
	usage: Record<string, SkillUsage>,
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
	};
	for (const s of skills) {
		if (s.source === "project") stats.projectCount++;
		else if (s.source === "user") stats.userCount++;
		stats.budgetUsed += s.promptChars;
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
		"catalog" | "searchQuery" | "sourceFilter" | "statusFilter" | "sort" | "usage"
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

	loadCatalog: async (cwd, force = false) => {
		const state = get();
		// Caching: do not refetch if already loaded for the same cwd unless force is true
		if (state.catalog && !force && state.lastLoadedCwd === cwd) {
			return;
		}

		set({ loading: true, error: null });
		try {
			const catalog = await skillsList(cwd);
			set((s) => ({
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
}));
