/**
 * Model a blank local draft will run with when the user has not picked one: the
 * effective `default` model role. Drafts own no process, so nothing else supplies it.
 */
import { useEffect, useState } from "react";
import { resolveRole } from "../../components/modelSelectLogic";
import { ompModelRolesRead, sessionPromptComposition } from "../../lib/ipc";
import { type ModelOption, toModelKey } from "../../lib/models";
import { effectiveRoles } from "./plan/planModelChoice";

const DEFAULT_ROLE = "default";

export function useDraftDefaultModel(
	enabled: boolean,
	cwd: string | null | undefined,
	models: ModelOption[] | null,
): string | null {
	const [roles, setRoles] = useState<{ cwd: string | null; value: Record<string, unknown> } | null>(null);
	const key = cwd ?? null;
	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		ompModelRolesRead(key, null)
			.then((snap) => !cancelled && setRoles({ cwd: key, value: effectiveRoles(snap) }))
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [enabled, key]);
	if (!enabled || !roles || roles.cwd !== key) return null;
	const r = resolveRole(roles.value, DEFAULT_ROLE, models);
	if (r.kind !== "model") return null;
	if (r.selector.includes("/")) return r.selector;
	return r.model ? toModelKey(r.model.provider, r.model.id) : null;
}

/**
 * Context an empty new session already carries (system prompt, tools, rules), read by a
 * throwaway no-session omp. Cached per cwd on the backend, so reopening a draft is instant.
 */
export function useDraftBaseContext(enabled: boolean, draftId: string, cwd: string | null | undefined): number | null {
	const [base, setBase] = useState<{ cwd: string; tokens: number } | null>(null);
	useEffect(() => {
		if (!enabled || !cwd) return;
		let cancelled = false;
		sessionPromptComposition(draftId, cwd)
			.then((c) => !cancelled && setBase({ cwd, tokens: c.reportedTokens ?? c.totalTokens }))
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [enabled, draftId, cwd]);
	return enabled && base && base.cwd === cwd ? base.tokens : null;
}
