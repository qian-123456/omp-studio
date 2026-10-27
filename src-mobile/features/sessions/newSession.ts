/** Pure state machine of the 「新建会话」 sheet: choose directory → choose model (+ thinking). */
import { thinkingOptions, type PickerModel } from "../../ui/ModelPicker";
import type { DirEntry } from "./tree";

export type NewSessionStep = "dir" | "model";

export interface NewSessionState {
	step: NewSessionStep;
	cwd: string | null;
	/** null = the workspace default model. */
	model: { provider: string; modelId: string } | null;
	/** null = auto / workspace default. */
	thinking: string | null;
}

export type NewSessionAction =
	| { type: "reset"; cwd?: string | null }
	| { type: "pickDir"; cwd: string }
	| { type: "next" }
	| { type: "back" }
	| { type: "pickModel"; model: PickerModel | null }
	| { type: "setThinking"; level: string | null };

export const initialNewSession = (cwd?: string | null): NewSessionState => ({
	step: "dir",
	cwd: cwd ?? null,
	model: null,
	thinking: null,
});

/** Preselect `defaultCwd` only when it is one of the offered directories. */
export const preselectCwd = (dirs: readonly DirEntry[], defaultCwd?: string | null): string | null =>
	defaultCwd && dirs.some((d) => d.path === defaultCwd) ? defaultCwd : null;

export function newSessionReducer(s: NewSessionState, a: NewSessionAction): NewSessionState {
	switch (a.type) {
		case "reset":
			return initialNewSession(a.cwd);
		case "pickDir":
			// A different directory has a different catalog/default; keep model choices (the catalog is global).
			return { ...s, cwd: a.cwd };
		case "next":
			return s.step === "dir" && s.cwd ? { ...s, step: "model" } : s;
		case "back":
			// Going back never discards choices.
			return s.step === "model" ? { ...s, step: "dir" } : s;
		case "pickModel": {
			if (!a.model) return { ...s, model: null, thinking: null };
			const keep = thinkingOptions(a.model).some((o) => o.value === s.thinking);
			return {
				...s,
				model: { provider: a.model.provider, modelId: a.model.id },
				thinking: keep ? s.thinking : null,
			};
		}
		case "setThinking":
			return { ...s, thinking: a.level };
	}
}

/** Body for `useSessions.createSession`. Thinking only applies together with an explicit model. */
export function createInput(
	s: NewSessionState,
	dirs: readonly DirEntry[],
): { cwd: string; model?: { provider: string; modelId: string }; thinking?: string; mode?: DirEntry["mode"] } | null {
	if (!s.cwd) return null;
	const dir = dirs.find((d) => d.path === s.cwd);
	const out: { cwd: string; model?: { provider: string; modelId: string }; thinking?: string; mode?: DirEntry["mode"] } = {
		cwd: s.cwd,
	};
	if (dir) out.mode = dir.kind === "global" ? "chat" : dir.mode;
	if (s.model) {
		out.model = s.model;
		if (s.thinking) out.thinking = s.thinking;
	}
	return out;
}
