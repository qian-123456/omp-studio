/** Pure helpers for the 记忆文件 editor (omp memory dir: ~/.omp/agent/memories/<slug>/). */

import { formatBytes } from "../../../lib/format";
import type { MemoryFileInfo } from "../../../lib/ipc";
import { tNow } from "../../../stores/language";
/** omp's per-project memory dir name: `--` + path with separators → `-` + `--`. */
export function cwdToMemorySlug(cwd: string): string {
	const trimmed = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
	return `--${trimmed.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

const GLOBAL_SUFFIX = ".omp-workspace-global";

function slugInner(slug: string): string {
	return slug.replace(/^--/, "").replace(/--$/, "");
}

function tildePath(path: string, home: string | null): string {
	if (!home) return path;
	const h = home.replace(/\/+$/, "");
	if (path === h) return "~";
	return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

/** `/a/b/c` → [`/a/b/c`, `/a/b`, `/a`]: a project can be a parent of the session cwd. */
function withAncestors(path: string): string[] {
	const out: string[] = [];
	let cur = path.length > 1 ? path.replace(/\/+$/, "") : path;
	while (cur.length > 1) {
		out.push(cur);
		cur = cur.slice(0, cur.lastIndexOf("/"));
	}
	return out;
}

export interface MemoryProjectLabel {
	/** Readable path (`~/…`, or 「全局（无项目）」). */
	label: string;
	/** True when the path was recovered unambiguously (global, or matched a known path). */
	exact: boolean;
}

/**
 * Readable form of a memory slug. The slug flattens `/` and `-` into `-`, so the
 * real path is only recoverable by matching known paths (the session cwd and its
 * ancestors); otherwise the part below the home dir is shown with its hyphens.
 */
export function memoryProjectLabel(
	slug: string,
	home: string | null,
	knownPaths: readonly string[] = [],
): MemoryProjectLabel {
	const inner = slugInner(slug);
	if (inner.endsWith(GLOBAL_SUFFIX)) return { label: tNow("memoryRules.globalNoProject"), exact: true };
	for (const known of knownPaths) {
		for (const p of withAncestors(known)) {
			if (cwdToMemorySlug(p) === slug) return { label: tildePath(p, home), exact: true };
		}
	}
	if (home) {
		const homeInner = slugInner(cwdToMemorySlug(home));
		if (inner === homeInner) return { label: "~", exact: true };
		if (inner.startsWith(`${homeInner}-`)) return { label: `~/${inner.slice(homeInner.length + 1)}`, exact: false };
	}
	return { label: inner, exact: false };
}

/** Project to preselect: the session's project when it has memory, else the first one. */
export function defaultMemorySlug(projects: string[], cwd: string | null): string | null {
	if (cwd) {
		const own = cwdToMemorySlug(cwd);
		if (projects.includes(own)) return own;
	}
	return projects[0] ?? null;
}

export function describeMemoryFile(rel: string): { title: string; role: string } {
	if (rel === "memory_summary.md") return { title: tNow("memoryRules.summaryTitle"), role: tNow("memoryRules.summaryRole") };
	if (rel === "MEMORY.md") return { title: tNow("memoryRules.fullMemoryTitle"), role: tNow("memoryRules.fullMemoryRole") };
	const skill = skillNameOf(rel);
	if (skill) return { title: skill, role: tNow("memoryRules.skillRole") };
	return { title: rel, role: "" };
}
/** Name of the skill folder for a `skills/<name>/SKILL.md` rel, else null. */
export function skillNameOf(rel: string): string | null {
	return /^skills\/([^/]+)\/SKILL\.md$/.exec(rel)?.[1] ?? null;
}

export interface MemoryFileSplit {
	/** memory_summary.md then MEMORY.md, whichever exist. */
	notes: MemoryFileInfo[];
	skills: MemoryFileInfo[];
	/** Count of read-only files omp regenerates (raw_memories.md, rollout summaries). */
	generatedCount: number;
}

export function splitMemoryFiles(files: MemoryFileInfo[]): MemoryFileSplit {
	const notes = ["memory_summary.md", "MEMORY.md"].flatMap((rel) => files.filter((f) => f.rel === rel));
	const skills = files.filter((f) => skillNameOf(f.rel) !== null);
	return { notes, skills, generatedCount: files.filter((f) => !f.editable).length };
}

/** `description:` of a SKILL.md frontmatter (plain, quoted, or `>`/`|` block scalar), else null. */
export function parseSkillDescription(text: string): string | null {
	const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!fm) return null;
	const lines = fm[1].split(/\r?\n/);
	const at = lines.findIndex((l) => /^description\s*:/.test(l));
	if (at < 0) return null;
	const first = lines[at].replace(/^description\s*:\s*/, "").trim();
	let value: string;
	if (/^[>|][+-]?$/.test(first)) {
		const block: string[] = [];
		for (const l of lines.slice(at + 1)) {
			if (l.trim() !== "" && !/^\s/.test(l)) break;
			block.push(l.trim());
		}
		value = block.join(first.startsWith("|") ? "\n" : " ").trim();
	} else {
		value = first.replace(/^(["'])(.*)\1$/, "$2");
	}
	return value === "" ? null : value;
}

export interface TextPreview {
	text: string;
	/** Lines not shown in `text`; 0 means the preview is the whole file. */
	hiddenLines: number;
}

/** First `maxLines` lines of `text` (trailing blank lines ignored). */
export function previewText(text: string, maxLines = 6): TextPreview {
	const lines = text.replace(/\s+$/, "").split(/\r?\n/);
	if (lines.length <= maxLines) return { text: lines.join("\n"), hiddenLines: 0 };
	return { text: lines.slice(0, maxLines).join("\n"), hiddenLines: lines.length - maxLines };
}

/** UTF-8 byte size of `text` in KB/B, e.g. 「2.3 KB」. */
export function formatTextSize(text: string): string {
	return formatBytes(new TextEncoder().encode(text).length);
}
