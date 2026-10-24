/**
 * Shared hooks for Settings sections: app settings + save path, the model
 * catalog for ModelSelect pickers, and the project scope cwd. Section files
 * use these instead of receiving props from SettingsPage.
 */
import { useEffect, useMemo } from "react";
import { tNow } from "../../stores/language";
import type { Model, Settings } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { pickCurrentModel, toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSettings } from "./store";

/** Thrown by `save` when a patch is rejected before reaching the store. */
export class SettingsValidationError extends Error {}

function validatePatch(patch: Partial<Settings>): string | null {
	if (patch.ompBinary !== undefined && !patch.ompBinary.trim()) return tNow("settingsCore.useAppSettings.ompBinaryRequired");
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
		toast.error(tNow("settingsCore.useAppSettings.saveFailed", { error: errMsg(err) }));
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
 * Session whose cwd and model scope the settings pages: the selected session,
 * else the last viewed one. null when nothing has been selected yet.
 */
export function useSettingsScopeSessionId(): string | null {
	return useUi((s) => s.selectedSessionId ?? s.lastSessionId);
}

/**
 * Project scope for project-level config (mcp.json, plugins, model roles): the
 * scope session's cwd — same rule as SkillsPage.
 */
export function useSettingsProjectCwd(): string | null {
	const scopeSessionId = useSettingsScopeSessionId();
	return useSessions((s) => (scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null));
}

/**
 * Model selector ("provider/id") of the scope session: the live get_state model
 * first, then the session meta. null when no session is in scope or it has none.
 */
export function useSettingsSessionModel(): string | null {
	const scopeSessionId = useSettingsScopeSessionId();
	const liveModel = useLive((s) => (scopeSessionId ? s.sessions[scopeSessionId]?.state?.model : undefined));
	const metaModel = useSessions((s) => (scopeSessionId ? s.sessions[scopeSessionId]?.model : undefined));
	const models = useModelOptions();
	return useMemo(() => {
		if (!scopeSessionId) return null;
		return pickCurrentModel([liveModel, metaModel], models).value || null;
	}, [scopeSessionId, liveModel, metaModel, models]);
}
