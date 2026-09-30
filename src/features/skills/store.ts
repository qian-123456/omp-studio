import { create } from "zustand";
import type { SkillsCatalog } from "../../lib/contracts";
import { skillsList } from "../../lib/ipc";

export interface SkillsState {
	catalog: SkillsCatalog | null;
	loading: boolean;
	error: string | null;
	activeTab: "skills" | "extensions";
	searchQuery: string;
	selectedSkillPath: string | null;
	selectedExtensionPath: string | null;
	lastLoadedCwd: string | null | undefined;

	loadCatalog: (cwd?: string | null, force?: boolean) => Promise<void>;
	refresh: (cwd?: string | null) => Promise<void>;
	setActiveTab: (tab: "skills" | "extensions") => void;
	setSearchQuery: (query: string) => void;
	setSelectedSkill: (path: string | null) => void;
	setSelectedExtension: (path: string | null) => void;
	updateExtensionEnabled: (path: string, enabled: boolean) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
	catalog: null,
	loading: false,
	error: null,
	activeTab: "skills",
	searchQuery: "",
	selectedSkillPath: null,
	selectedExtensionPath: null,
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
			set((s) => {
				const currentSkillPath = s.selectedSkillPath;
				const currentExtPath = s.selectedExtensionPath;

				const nextSkillPath =
					currentSkillPath && catalog.skills.some((sk) => sk.path === currentSkillPath)
						? currentSkillPath
						: catalog.skills[0]?.path ?? null;

				const nextExtPath =
					currentExtPath && catalog.extensions.some((ex) => ex.path === currentExtPath)
						? currentExtPath
						: catalog.extensions[0]?.path ?? null;

				return {
					catalog,
					loading: false,
					error: null,
					lastLoadedCwd: cwd,
					selectedSkillPath: nextSkillPath,
					selectedExtensionPath: nextExtPath,
				};
			});
		} catch (err) {
			set({
				loading: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	},

	refresh: async (cwd) => {
		return get().loadCatalog(cwd, true);
	},

	setActiveTab: (tab) => set({ activeTab: tab }),

	setSearchQuery: (query) => set({ searchQuery: query }),

	setSelectedSkill: (path) => set({ selectedSkillPath: path }),

	setSelectedExtension: (path) => set({ selectedExtensionPath: path }),

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
