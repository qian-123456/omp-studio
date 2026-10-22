import { create } from "zustand";
import type {
	ExtensionItem,
	SkillItem,
	SkillUsage,
	SkillUsageReport,
	SkillsCatalog,
} from "../../lib/contracts";
import {
	extensionEnableFile,
	ompConfigList,
	ompProjectConfigRead,
	ompConfigSet,
	skillsList,
	skillsTrash,
	skillsUsage,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import {
	DEFAULT_SKILL_CONFIG,
	EMPTY_PROJECT_LAYER,
	mergeSkillConfig,
	parseProjectSkillLayer,
	parseSkillConfig,
	resolveSkillEnablement,
	type SkillEnableConfig,
} from "../../lib/skillEnablement";
import { useOmpConfigStore } from "../settings/ompConfigStore";

/** Toast when a global write would be a no-op because the project config overrides it. */
const PROJECT_OVERRIDE_WRITE_BLOCKED =
	"这个项目的 .omp/config.yml 自带一份停用名单，全局开关在本项目里不起作用，未修改任何配置";

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
	/** Config keys the project `.omp/config.yml` overrides (global writes can't reach them). */
	skillConfigOverrides: string[];
	/** Path of the project config read for the current cwd (null without a project). */
	projectConfigPath: string | null;
	/** Non-blocking notice when the project config could not be read/parsed. */
	projectConfigNotice: string | null;
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
	/** Toggle an extension (disabledExtensions + `.disabled` rename); errors become toasts. */
	setExtensionEnabled: (ext: ExtensionItem, enabled: boolean, cwd: string | null) => Promise<void>;
	/** Silent refetch: keeps current data visible, swaps in the new catalog on success. */
	revalidateCatalog: (cwd: string | null) => Promise<void>;
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
	/** Skills filtered out of new sessions by config (any reason). */
	disabled: number;
}



let configWriteChain: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write helper for OMP config keys holding string lists.
 * `mutate` returns the next array; returning the same array skips the write.
 * Serialized: concurrent toggles must not lose each other's writes.
 */
export function updateOmpListSetting(
	key: string,
	mutate: (current: string[]) => string[],
): Promise<void> {
	const run = async () => {
		const list = await ompConfigList();
		const entry = list.entries.find((e) => e.key === key);
		const current =
			entry && Array.isArray(entry.value)
				? entry.value.filter((v): v is string => typeof v === "string")
				: [];
		const next = mutate(current);
		if (next === current) return;
		await ompConfigSet(key, JSON.stringify(next));
	};
	const result = configWriteChain.then(run, run);
	configWriteChain = result.catch(() => undefined);
	return result;
}
/** Pure stats used by the stat cards; exported for tests. */
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
		disabled: 0,
	};
	for (const s of skills) {
		if (s.source === "project") stats.projectCount++;
		else if (s.source === "user") stats.userCount++;
		if (!resolveSkillEnablement(s, cfg).enabled) stats.disabled++;
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
/** Latest catalog request id; stale responses are dropped. */
let catalogSeq = 0;

interface LoadedConfig {
	skillConfig: SkillEnableConfig;
	overrides: string[];
	projectConfigPath: string | null;
	projectConfigNotice: string | null;
}

/** Global layer + project layer (arrays replace, scalars win). Project failure → global only. */
async function fetchEffectiveConfig(cwd: string | null | undefined): Promise<LoadedConfig> {
	const [configList, project] = await Promise.all([
		// Config fetch failure must not block the catalog — fall back to
		// the all-enabled defaults.
		Promise.resolve()
			.then(() => ompConfigList())
			.catch(() => null),
		cwd
			? Promise.resolve()
					.then(() => ompProjectConfigRead(cwd))
					.then(
						(file) => ({ file, error: null as string | null }),
						(err: unknown) => ({
							file: null,
							error: err instanceof Error ? err.message : String(err),
						}),
					)
			: Promise.resolve({ file: null, error: null as string | null }),
	]);
	const global = configList ? parseSkillConfig(configList) : DEFAULT_SKILL_CONFIG;
	let layer = EMPTY_PROJECT_LAYER;
	let notice = project.error
		? `读取项目配置失败，已只按全局配置显示：${project.error}`
		: null;
	if (project.file?.exists) {
		try {
			layer = parseProjectSkillLayer(project.file.content);
		} catch (err) {
			notice = `项目配置 ${project.file.path} 解析失败，已只按全局配置显示：${
				err instanceof Error ? err.message : String(err)
			}`;
		}
	}
	const { config, overrides } = mergeSkillConfig(global, layer);
	return {
		skillConfig: config,
		overrides,
		projectConfigPath: project.file?.path ?? null,
		projectConfigNotice: notice,
	};
}

async function fetchCatalogAndConfig(cwd: string | null | undefined) {
	const [catalog, loaded] = await Promise.all([skillsList(cwd), fetchEffectiveConfig(cwd)]);
	return {
		catalog,
		skillConfig: loaded.skillConfig,
		overrides: loaded.overrides,
		projectConfigPath: loaded.projectConfigPath,
		projectConfigNotice: loaded.projectConfigNotice,
	};
}

/** Keeps the drawer only when its target still exists in the new catalog. */
function drawerAfterReload(
	drawer: SkillsDrawerTarget | null,
	catalog: SkillsCatalog,
): SkillsDrawerTarget | null {
	if (!drawer) return null;
	const found =
		drawer.kind === "skill"
			? catalog.skills.some((sk) => sk.path === drawer.path)
			: catalog.extensions.some((ex) => ex.path === drawer.path);
	return found ? drawer : null;
}

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
	skillConfigOverrides: [],
	projectConfigPath: null,
	projectConfigNotice: null,
	trashingDirs: [],

	loadCatalog: async (cwd, force = false) => {
		const state = get();
		// Caching: do not refetch if already loaded for the same cwd unless force is true
		if (state.catalog && !force && state.lastLoadedCwd === cwd) {
			return;
		}

		const seq = ++catalogSeq;
		set({ loading: true, error: null });
		try {
			const loaded = await fetchCatalogAndConfig(cwd);
			const { catalog } = loaded;
			if (seq !== catalogSeq) return;
			set((s) => ({
				skillConfig: loaded.skillConfig,
				skillConfigOverrides: loaded.overrides,
				projectConfigPath: loaded.projectConfigPath,
				projectConfigNotice: loaded.projectConfigNotice,
				catalog,
				loading: false,
				error: null,
				lastLoadedCwd: cwd,
				// Close the drawer when its target disappeared after a reload.
				drawer: drawerAfterReload(s.drawer, catalog),
			}));
		} catch (err) {
			if (seq !== catalogSeq) return;
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

	setExtensionEnabled: async (ext, enabled, cwd) => {
		if (get().skillConfigOverrides.includes("disabledExtensions")) {
			toast.error(PROJECT_OVERRIDE_WRITE_BLOCKED);
			return;
		}
		const prevConfig = get().skillConfig;
		const prevEnabled =
			get().catalog?.extensions.find((e) => e.path === ext.path)?.enabled ?? ext.enabled;
		const needsRename = enabled && ext.path.endsWith(".disabled");
		const nextList = (cur: string[]) =>
			enabled
				? cur.filter(
						(id) =>
							id !== ext.name &&
							id !== `extension-module:${ext.name}` &&
							id !== ext.path,
					)
				: [...new Set([...cur, ext.name])];

		// Optimistic: reflect the write immediately, roll back on failure.
		set({
			skillConfig: {
				...prevConfig,
				disabledExtensions: nextList(prevConfig.disabledExtensions),
			},
		});
		get().updateExtensionEnabled(ext.path, enabled);
		try {
			try {
				await updateOmpListSetting("disabledExtensions", nextList);
			} finally {
				useOmpConfigStore.getState().invalidate();
			}
			if (needsRename) {
				await extensionEnableFile(ext.path, cwd);
				// The file path changed: pull the new catalog.
				await get().revalidateCatalog(cwd);
			}
			toast.success(
				enabled ? `已启用扩展 ${ext.name}` : `已禁用扩展 ${ext.name}`,
			);
		} catch (err) {
			set({ skillConfig: prevConfig });
			get().updateExtensionEnabled(ext.path, prevEnabled);
			toast.error(
				`更新扩展状态失败: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	},

	revalidateCatalog: async (cwd) => {
		const seq = ++catalogSeq;
		try {
			const loaded = await fetchCatalogAndConfig(cwd);
			const { catalog } = loaded;
			if (seq !== catalogSeq) return;
			set((s) => ({
				skillConfig: loaded.skillConfig,
				skillConfigOverrides: loaded.overrides,
				projectConfigPath: loaded.projectConfigPath,
				projectConfigNotice: loaded.projectConfigNotice,
				catalog,
				loading: false,
				error: null,
				lastLoadedCwd: cwd,
				drawer: drawerAfterReload(s.drawer, catalog),
			}));
		} catch (err) {
			if (seq !== catalogSeq) return;
			// Keep the visible data; surface the error only when there is none.
			set((s) => ({
				loading: false,
				error: s.catalog ? s.error : err instanceof Error ? err.message : String(err),
			}));
		}
	},

	setSkillEnabled: async (skill, enabled) => {
		const overrides = get().skillConfigOverrides;
		if (overrides.includes("disabledExtensions")) {
			toast.error(PROJECT_OVERRIDE_WRITE_BLOCKED);
			return;
		}
		const prev = get().skillConfig;
		const marker = `skill:${skill.name}`;
		// Re-enabling also clears an exact-name ignoredSkills entry so the
		// skill is actually live (glob matches stay — switch is locked for them).
		const clearExactIgnored =
			enabled &&
			!overrides.includes("skills.ignoredSkills") &&
			prev.ignored.includes(skill.name);

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
			useOmpConfigStore.getState().invalidate();
			toast.success(
				enabled
					? `已启用 ${skill.name}，新会话生效`
					: `已停用 ${skill.name}，新会话生效`,
			);
		} catch (err) {
			useOmpConfigStore.getState().invalidate();
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
