/**
 * [D] Model kinds for Settings ▸ 模型角色 ▸ 批量替换模型.
 *
 * omp's catalog has several kinds of "model": chat models, web-search
 * services (`web/*`), judge models (`typesafe/jev-*`), image/speech runners…
 * The replace dialog groups them apart, tests each kind the way omp uses it,
 * and only offers same-kind targets. The full catalog of every kind is loaded
 * once per app run via `model_kind_catalog` (slow: `omp models --kind all`).
 */
import { create } from "zustand";
import type { ModelKindEntry, ModelProbeKind } from "../../../lib/contracts";
import { modelKindCatalog } from "../../../lib/ipc";
import { tNow } from "../../../stores/language";

/** Display groups. `missing` = not in the catalog at all (likely dead). */
export type KindGroup = "missing" | "chat" | "search" | "judge" | "other";

/** Section order in the overview: the actionable "missing" group first. */
export const KIND_GROUP_ORDER: readonly KindGroup[] = ["missing", "chat", "search", "judge", "other"];

export const KIND_GROUP_KEYS: Record<KindGroup, string> = {
	missing: "modelReplace.kindGroup.missing",
	chat: "modelReplace.kindGroup.chat",
	search: "modelReplace.kindGroup.search",
	judge: "modelReplace.kindGroup.judge",
	other: "modelReplace.kindGroup.other",
};

export function kindGroupTitle(group: KindGroup): string {
	return tNow(KIND_GROUP_KEYS[group]);
}

export const KIND_GROUP_TITLES: Record<KindGroup, string> = new Proxy({} as Record<KindGroup, string>, {
	get(_target, prop: string) {
		const key = KIND_GROUP_KEYS[prop as KindGroup];
		return key ? tNow(key) : undefined;
	},
});

/** Group of an omp catalog kind; `undefined` (not in catalog) → `missing`. */
export function kindGroup(kind: string | undefined): KindGroup {
	switch (kind) {
		case undefined:
			return "missing";
		case "chat":
		case "tiny":
			return "chat";
		case "search":
			return "search";
		case "judge":
			return "judge";
		default:
			return "other";
	}
}

/**
 * How a group is probed, or null when it has no real test. A model missing
 * from the catalog is probed as chat (the only kind omp can still try to run).
 */
export function probeKindOf(group: KindGroup): ModelProbeKind | null {
	switch (group) {
		case "missing":
		case "chat":
			return "chat";
		case "search":
			return "search";
		case "judge":
			return "judge";
		case "other":
			return null;
	}
}

/** Thinking levels only mean something for chat models. */
export function groupTakesThinkingLevel(group: KindGroup): boolean {
	return group === "chat" || group === "missing";
}

interface ModelKindCatalogState {
	entries: ModelKindEntry[] | null;
	/** selector → omp kind; empty until loaded. */
	kindBySelector: ReadonlyMap<string, string>;
	loading: boolean;
	error: string | null;
	/** Load once; `force` re-runs omp (e.g. after 重新扫描). */
	load: (force?: boolean) => Promise<void>;
}

export const useModelKindCatalog = create<ModelKindCatalogState>((set, get) => ({
	entries: null,
	kindBySelector: new Map(),
	loading: false,
	error: null,
	load: async (force = false) => {
		const state = get();
		if (state.loading || (state.entries !== null && !force)) return;
		set({ loading: true, error: null });
		try {
			const entries = await modelKindCatalog();
			set({
				entries,
				kindBySelector: new Map(entries.map((e) => [e.selector, e.kind])),
				loading: false,
			});
		} catch (err) {
			set({ loading: false, error: String(err) });
		}
	},
}));
