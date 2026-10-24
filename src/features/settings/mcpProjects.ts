/** Pure project/scope helpers for Settings ▸ MCP 服务器. */
import type { McpScope, McpServerItem, McpServerView, Workspace } from "../../lib/contracts";
import { projectName } from "./mcpDraft";

export interface KnownProject {
	path: string;
	name: string;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);

/** `child` equals `dir` or lives below it. */
function isInside(dir: string, child: string): boolean {
	const d = trimSlash(dir);
	const c = trimSlash(child);
	return c === d || c.startsWith(`${d}/`) || c.startsWith(`${d}\\`);
}

/**
 * Known projects (kind "project", deduped by path, sorted by name) and the current one:
 * the deepest project containing `cwd`. A `cwd` outside every project becomes an extra project.
 */
export function deriveProjects(
	workspaces: readonly Workspace[],
	cwd: string | null,
): { projects: KnownProject[]; current: string | null } {
	const byPath = new Map<string, KnownProject>();
	for (const w of workspaces) {
		if (w.kind !== "project") continue;
		const key = trimSlash(w.path);
		if (!byPath.has(key)) byPath.set(key, { path: w.path, name: w.name || projectName(w.path) });
	}
	let current: string | null = null;
	if (cwd) {
		for (const p of byPath.values()) {
			if (isInside(p.path, cwd) && (!current || trimSlash(p.path).length > trimSlash(current).length)) {
				current = p.path;
			}
		}
		if (!current) {
			current = cwd;
			byPath.set(trimSlash(cwd), { path: cwd, name: projectName(cwd) });
		}
	}
	const projects = [...byPath.values()].sort(
		(a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.path.localeCompare(b.path),
	);
	return { projects, current };
}

const uniq = (xs: string[]) => [...new Set(xs)];

/** Keep `projects` in the known-projects order. */
function inOrder(known: readonly string[], projects: readonly string[]): string[] {
	const set = new Set(projects);
	return known.filter((p) => set.has(p));
}

/** Scope shown when the scope dialog / editor opens for an existing server. */
export function prefillScope(
	view: McpServerView,
	known: readonly string[],
	current: string | null,
): McpScope {
	// A paused server that only has its global entry was "all projects" before pausing.
	const wasAll = view.mode === "off" && view.hasGlobal && view.copyProjects.length === 0;
	if (view.mode === "all" || wasAll) {
		const ex = new Set(view.excludedProjects);
		return { allProjects: true, projects: known.filter((p) => !ex.has(p)) };
	}
	if (view.mode === "projects") return { allProjects: false, projects: [...view.activeProjects] };
	if (view.copyProjects.length > 0) return { allProjects: false, projects: [...view.copyProjects] };
	return { allProjects: false, projects: current ? [current] : [] };
}

/** Default scope for a new server: only the current project when there is one, else everywhere. */
export function defaultAddScope(known: readonly string[], current: string | null): McpScope {
	return current ? { allProjects: false, projects: [current] } : { allProjects: true, projects: [...known] };
}

/** One-click 「加到当前项目」: the server's scope with `current` added. */
export function scopeWithCurrent(
	view: McpServerView,
	known: readonly string[],
	current: string,
): McpScope {
	if (view.mode === "all") {
		const ex = new Set(view.excludedProjects);
		ex.delete(current);
		return { allProjects: true, projects: known.filter((p) => !ex.has(p)) };
	}
	const base = view.mode === "projects" ? view.activeProjects : view.copyProjects;
	return { allProjects: false, projects: inOrder(known, uniq([...base, current])) };
}

export function sameScope(a: McpScope, b: McpScope): boolean {
	if (a.allProjects !== b.allProjects) return false;
	const x = [...a.projects].sort();
	const y = [...b.projects].sort();
	return x.length === y.length && x.every((p, i) => p === y[i]);
}

/** Only-selected-projects scope with nothing selected cannot be saved. */
export function scopeError(scope: McpScope): string | null {
	return !scope.allProjects && scope.projects.length === 0 ? "请至少选择一个项目" : null;
}

/** True when the definition holds env/header values hidden from the UI. */
export function hasMaskedSecrets(item: McpServerItem): boolean {
	return [...item.env, ...item.headers].some((kv) => kv.masked);
}
