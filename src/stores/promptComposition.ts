/**
 * 系统提示词构成 settings page hand-off: which project the page should open on, and the
 * last project the user looked at. Other features open the page through
 * `openPromptComposition` instead of touching the settings section directly.
 */
import { create } from "zustand";
import { useUi } from "./ui";

export const PROMPT_COMPOSITION_SECTION = "prompt-composition";
const STORAGE_KEY = "ompws.promptComposition.lastCwd";

function loadLast(): string | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

interface PromptCompositionState {
	/** Project the next page open should select (null = use `lastCwd` / Universal). */
	requestedCwd: string | null;
	/** Bumped by every `openPromptComposition` so a mounted page re-applies the request. */
	requestId: number;
	lastCwd: string | null;
	setLastCwd(cwd: string): void;
}

export const usePromptComposition = create<PromptCompositionState>((set) => ({
	requestedCwd: null,
	requestId: 0,
	lastCwd: loadLast(),
	setLastCwd: (cwd) => {
		try {
			localStorage.setItem(STORAGE_KEY, cwd);
		} catch {
			/* storage unavailable */
		}
		set({ lastCwd: cwd });
	},
}));

/** Open Settings ▸ 系统提示词构成, preselecting `cwd` (e.g. the session's project). */
export function openPromptComposition(cwd: string | null): void {
	usePromptComposition.setState((s) => ({ requestedCwd: cwd, requestId: s.requestId + 1 }));
	useUi.getState().openSettings(PROMPT_COMPOSITION_SECTION);
}
