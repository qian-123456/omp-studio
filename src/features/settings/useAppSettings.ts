/**
 * Shared hooks for Settings sections: app settings + save path, the model
 * catalog for ModelSelect pickers, and the project scope cwd. Section files
 * use these instead of receiving props from SettingsPage.
 */
import { useEffect, useMemo } from "react";
import type { Model, Settings } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useModelCatalog } from "../../stores/modelCatalog";
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

const NO_MODELS: Model[] = [];

/** Shared model catalog for settings sections; each mount refreshes it. */
export function useCatalogModels(): { models: Model[]; catalogKeys: Set<string> } {
	const models = useModelCatalog((s) => s.models) ?? NO_MODELS;
	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);
	const catalogKeys = useMemo(
		() => new Set(models.map((m) => toModelKey(m.provider, m.id))),
		[models],
	);
	return { models, catalogKeys };
}

/**
 * Project scope for project-level config (mcp.json, plugins, model roles):
 * the selected (or last viewed) session's cwd — same rule as SkillsPage.
 */
export function useSettingsProjectCwd(): string | null {
	const scopeSessionId = useUi((s) => s.selectedSessionId ?? s.lastSessionId);
	return useSessions((s) => (scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null));
}
