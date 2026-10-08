/**
 * Shared hooks for Settings sections: app settings + save path, the model
 * catalog for ModelSelect pickers, and the project scope cwd. Section files
 * use these instead of receiving props from SettingsPage.
 */
import { useEffect, useMemo, useState } from "react";
import type { Model, Settings } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { listModels } from "../../lib/ipc";
import { toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSettings } from "./store";

/** Thrown by `save` when a patch is rejected before reaching the store. */
export class SettingsValidationError extends Error {}

function validatePatch(patch: Partial<Settings>): string | null {
	if (patch.supervisorModel !== undefined && !patch.supervisorModel.trim()) return "监工模型不能为空";
	if (patch.ompBinary !== undefined && !patch.ompBinary.trim()) return "OMP 命令行程序不能为空";
	return null;
}

/**
 * Persist a patch of app settings. Validation failures and save errors are
 * toasted here and re-thrown so callers (useSaveStatus) can show the state.
 */
export async function saveAppSettings(patch: Partial<Settings>): Promise<void> {
	const invalid = validatePatch(patch);
	if (invalid) {
		toast.error(invalid);
		throw new SettingsValidationError(invalid);
	}
	try {
		await useSettings.getState().update(patch);
	} catch (err) {
		toast.error(`保存失败: ${errMsg(err)}`);
		throw err;
	}
}

/** App settings (`null` until loaded) and the save function. */
export function useAppSettings(): {
	settings: Settings | null;
	save: (patch: Partial<Settings>) => Promise<void>;
} {
	const settings = useSettings((s) => s.settings);
	return { settings, save: saveAppSettings };
}

let modelCache: Model[] | null = null;
let modelLoad: Promise<Model[]> | null = null;

function getInitialModelCache(): Model[] {
	if (modelCache && modelCache.length > 0) return modelCache;
	try {
		const raw = localStorage.getItem("ompws:cached-models");
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length > 0) {
				modelCache = parsed;
				return parsed;
			}
		}
	} catch {
		/* ignore */
	}
	return [];
}

/** Concurrent mounts share one in-flight request; each new mount refreshes. */
function loadModels(): Promise<Model[]> {
	modelLoad ??= listModels()
		.then((list) => {
			if (Array.isArray(list) && list.length > 0) {
				modelCache = list;
				try {
					localStorage.setItem("ompws:cached-models", JSON.stringify(list));
				} catch {
					/* ignore */
				}
			}
			return modelCache ?? [];
		})
		.catch(() => modelCache ?? [])
		.finally(() => {
			modelLoad = null;
		});
	return modelLoad;
}

/** Model catalog (`omp --list-models`) shared across sections; last result seeds new mounts. */
export function useModelCatalog(): {
	models: Model[];
	catalogKeys: Set<string>;
	loaded: boolean;
	loading: boolean;
} {
	const [models, setModels] = useState<Model[]>(() => getInitialModelCache());
	const [loaded, setLoaded] = useState<boolean>(() => Boolean(modelCache && modelCache.length > 0));
	const [loading, setLoading] = useState<boolean>(() => !modelCache || modelCache.length === 0);

	useEffect(() => {
		let alive = true;
		void loadModels().then((list) => {
			if (alive) {
				setModels(list);
				setLoaded(true);
				setLoading(false);
			}
		});
		return () => {
			alive = false;
		};
	}, []);
	const catalogKeys = useMemo(
		() => new Set(models.map((m) => toModelKey(m.provider, m.id))),
		[models],
	);
	return { models, catalogKeys, loaded, loading };
}

/**
 * Project scope for project-level config (mcp.json, plugins, model roles):
 * the selected (or last viewed) session's cwd — same rule as SkillsPage.
 */
export function useSettingsProjectCwd(): string | null {
	const scopeSessionId = useUi((s) => s.selectedSessionId ?? s.lastSessionId);
	return useSessions((s) => (scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null));
}
