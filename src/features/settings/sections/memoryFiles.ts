/** Pure helpers for the 记忆文件 editor (omp memory dir: ~/.omp/agent/memories/<slug>/). */

import type { MemoryFileInfo } from "../../../lib/ipc";

/** omp's per-project memory dir name: `--` + path with separators → `-` + `--`. */
export function cwdToMemorySlug(cwd: string): string {
	const trimmed = cwd.length > 1 ? cwd.replace(/\/+$/, "") : cwd;
	return `--${trimmed.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Display form of a slug (drops the `--` wrapper; hyphens stay ambiguous). */
export function memorySlugLabel(slug: string): string {
	const inner = slug.replace(/^--/, "").replace(/--$/, "");
	return inner === ".omp-workspace-global" || inner === "Users-.omp-workspace-global"
		? "全局（无项目）"
		: inner;
}

/** Project to preselect: the session's project when it has memory, else the first one. */
export function defaultMemorySlug(projects: string[], cwd: string | null): string | null {
	if (cwd) {
		const own = cwdToMemorySlug(cwd);
		if (projects.includes(own)) return own;
	}
	return projects[0] ?? null;
}

export interface MemoryFileGroup {
	id: "summary" | "skills" | "generated";
	title: string;
	hint: string;
	files: MemoryFileInfo[];
}

const TITLES: Record<string, { title: string; hint: string }> = {
	"memory_summary.md": {
		title: "memory_summary.md",
		hint: "记忆摘要：新会话开头注入给 AI 的精简版。",
	},
	"MEMORY.md": {
		title: "MEMORY.md",
		hint: "完整记忆手册：AI 需要细节时才读取。",
	},
	"raw_memories.md": {
		title: "raw_memories.md",
		hint: "整理前的原始记忆，由 omp 生成，只读。",
	},
};

export function describeMemoryFile(rel: string): { title: string; hint: string } {
	const fixed = TITLES[rel];
	if (fixed) return fixed;
	const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(rel);
	if (skill) return { title: skill[1], hint: "omp 沉淀出的技能，可编辑或删除。" };
	const roll = /^rollout_summaries\/(.+)$/.exec(rel);
	if (roll) return { title: roll[1], hint: "某次会话的摘要，由 omp 生成，只读。" };
	return { title: rel, hint: "" };
}

/** Name of the skill folder for a `skills/<name>/SKILL.md` rel, else null. */
export function skillNameOf(rel: string): string | null {
	return /^skills\/([^/]+)\/SKILL\.md$/.exec(rel)?.[1] ?? null;
}

export function groupMemoryFiles(files: MemoryFileInfo[]): MemoryFileGroup[] {
	const summary = files.filter((f) => f.rel === "memory_summary.md" || f.rel === "MEMORY.md");
	const skills = files.filter((f) => skillNameOf(f.rel) !== null);
	const generated = files.filter((f) => !f.editable);
	const groups: MemoryFileGroup[] = [
		{ id: "summary", title: "可编辑的记忆", hint: "修改后新开的会话生效。", files: summary },
		{ id: "skills", title: "沉淀的技能", hint: "每个技能一个文件夹，可编辑或删除。", files: skills },
		{ id: "generated", title: "omp 自动生成（只读）", hint: "omp 会重新生成这些文件，手改没有意义。", files: generated },
	];
	return groups.filter((g) => g.files.length > 0);
}
