/**
 * Space modes (空间): each mode is a visually independent sidebar space with
 * its own projects, sessions, 无项目 area and groups — nothing is shared.
 * Pure helpers shared by the sidebar, pickers and tests.
 */

import {
	BookOpen,
	Briefcase,
	FlaskConical,
	Globe,
	SquareTerminal,
	type LucideIcon,
} from "lucide-react";
import type { SessionMeta, SpaceMode, Workspace } from "../../lib/contracts";

export const SPACE_MODES: readonly SpaceMode[] = [
	"code",
	"work",
	"study",
	"research",
	"chat",
];

export interface SpaceModeMeta {
	label: string;
	icon: LucideIcon;
}

export const SPACE_MODE_META: Record<SpaceMode, SpaceModeMeta> = {
	code: { label: "Code", icon: SquareTerminal },
	work: { label: "Work", icon: Briefcase },
	study: { label: "Study", icon: BookOpen },
	research: { label: "Research", icon: FlaskConical },
	chat: { label: "Universal", icon: Globe },
};

export function isSpaceMode(value: unknown): value is SpaceMode {
	return (
		typeof value === "string" &&
		(SPACE_MODES as readonly string[]).includes(value)
	);
}

/** Id of the single global (project-less) workspace; it belongs to `chat`. */
export const GLOBAL_WORKSPACE_ID = "global";

/** Whether a space holds project directories (everything except 通用对话). */
export function modeHasProjects(mode: SpaceMode): boolean {
	return mode !== "chat";
}

/** A workspace id is the global (通用对话) workspace row. */
export function isGlobalWorkspaceId(id: string): boolean {
	return id === GLOBAL_WORKSPACE_ID;
}

/**
 * The global workspace row — only the 通用对话 (`chat`) space has one; every
 * other mode returns null.
 */
export function modeGlobalWorkspace(
	workspaces: readonly Workspace[],
	mode: SpaceMode,
): Workspace | null {
	if (mode !== "chat") return null;
	return (
		workspaces.find(
			(w) => w.kind === "global" && (w.mode === "chat" || w.id === GLOBAL_WORKSPACE_ID),
		) ?? null
	);
}

/** Project workspaces of one mode, sidebar sort order. */
export function modeProjectWorkspaces(
	workspaces: readonly Workspace[],
	mode: SpaceMode,
): Workspace[] {
	return workspaces
		.filter((w) => w.kind !== "global" && w.mode === mode)
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/**
 * Workspace that best owns `repoRoot ?? cwd` inside `mode` — deepest project
 * path wins, then the mode's global when cwd sits under its dir. Mirrors the
 * backend's same-mode resolution so stubs never escape their space.
 */
export function resolveWorkspaceIdForMode(
	workspaces: readonly Workspace[],
	repoRoot: string | null,
	cwd: string,
	mode: SpaceMode,
): string | null {
	const within = (path: string, root: string): boolean => {
		const r = root.replace(/\/+$/, "");
		return path === r || path.startsWith(`${r}/`);
	};
	for (const target of [repoRoot, cwd]) {
		if (!target) continue;
		const best = workspaces
			.filter(
				(w) => w.kind === "project" && w.mode === mode && within(target, w.path),
			)
			.sort((a, b) => b.path.length - a.path.length)[0];
		if (best) return best.id;
	}
	const global = modeGlobalWorkspace(workspaces, mode);
	return global && within(cwd, global.path) ? global.id : null;
}

/**
 * Pick the workspace a new session should target inside `mode`:
 * 通用对话 → the global workspace. Project modes → the project of the
 * currently selected session (same mode), else the most recently updated
 * session's project in the mode, else the mode's first project, else null (the
 * launcher asks for a directory).
 */
export function resolveNewSessionTargetWorkspace(
	mode: SpaceMode,
	selectedSessionId: string | null,
	sessions: Record<string, SessionMeta> | readonly SessionMeta[],
	workspaces: readonly Workspace[],
): Workspace | null {
	const projects = modeProjectWorkspaces(workspaces, mode);
	const byId: Record<string, Workspace> = Object.fromEntries(
		projects.map((w) => [w.id, w]),
	);

	const list = Array.isArray(sessions) ? sessions : Object.values(sessions);
	const selected = selectedSessionId
		? list.find((s) => s.id === selectedSessionId)
		: undefined;
	if (selected?.workspaceId && byId[selected.workspaceId]) {
		return byId[selected.workspaceId];
	}

	let best: Workspace | null = null;
	let bestTime = -Infinity;
	for (const s of list) {
		const ws = s.workspaceId ? byId[s.workspaceId] : undefined;
		if (!ws) continue;
		const t = Date.parse(s.updatedAt || s.createdAt || "") || 0;
		if (t >= bestTime) {
			bestTime = t;
			best = ws;
		}
	}
	// 通用对话 always uses global; project modes fall back to the first project
	// even when it has no sessions yet (otherwise the launcher spins forever
	// because `ready` is true but nothing is ever created).
	if (mode === "chat") return modeGlobalWorkspace(workspaces, mode);
	return best ?? projects[0] ?? null;
}
