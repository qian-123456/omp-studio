/**
 * Pure helpers for the AGENTS.md settings section: which file to edit and
 * how to detect on-disk changes before saving.
 *
 * File-target rule (omp docs, context-files.md):
 * - User scope: `~/.omp/agent/AGENTS.md` (native provider, shadows every other user file).
 * - Project scope, depth 0: `<cwd>/.omp/AGENTS.md` (native, priority 100) shadows
 *   `<cwd>/AGENTS.md` (agents-md, priority 10) when it exists and is non-empty.
 */

export type AgentsMdScope = "global" | "project";
export type ProjectTarget = "root" | "native";

/** Files larger than this open read-only. */
export const MAX_EDIT_BYTES = 1024 * 1024;

export const GLOBAL_AGENTS_MD = "~/.omp/agent/AGENTS.md";

function trimSlash(dir: string): string {
	return dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
}

export function projectAgentsMdPath(cwd: string, target: ProjectTarget): string {
	const base = trimSlash(cwd);
	return target === "native" ? `${base}/.omp/AGENTS.md` : `${base}/AGENTS.md`;
}

export function projectOmpDir(cwd: string): string {
	return `${trimSlash(cwd)}/.omp`;
}

/** On-disk state of one candidate file: null content = missing. */
export interface CandidateState {
	content: string | null;
}

/**
 * Which project file omp actually injects at depth 0, or null when neither
 * contributes (missing or empty files contribute nothing).
 */
export function effectiveProjectTarget(root: CandidateState, native: CandidateState): ProjectTarget | null {
	if (native.content !== null && native.content.trim() !== "") return "native";
	if (root.content !== null && root.content.trim() !== "") return "root";
	return null;
}

/** Default file to edit: the one omp loads, else an existing native file, else `<cwd>/AGENTS.md`. */
export function defaultProjectTarget(root: CandidateState, native: CandidateState): ProjectTarget {
	return effectiveProjectTarget(root, native) ?? (native.content !== null ? "native" : "root");
}

export function isTooLargeToEdit(text: string): boolean {
	return new TextEncoder().encode(text).length > MAX_EDIT_BYTES;
}

export type SaveCheck =
	| { kind: "ok" }
	/** File changed (or appeared / disappeared) on disk since it was loaded. */
	| { kind: "conflict"; onDisk: string | null };

/**
 * Compare what was loaded with what is on disk right before writing.
 * `loaded`/`onDisk` null = file did not exist.
 */
export function checkBeforeSave(loaded: string | null, onDisk: string | null): SaveCheck {
	return loaded === onDisk ? { kind: "ok" } : { kind: "conflict", onDisk };
}

/** Minimal starter content for a newly created file. */
export const STARTER_TEMPLATE = "# AGENTS.md\n\n";
