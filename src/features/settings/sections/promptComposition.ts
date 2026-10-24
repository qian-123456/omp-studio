/** Pure helpers for Settings ▸ 系统提示词构成: project options and the 「让 AI 帮我优化」 prompt. */
import type { PromptCategory, PromptComposition, PromptItem, Workspace } from "../../../lib/contracts";
import { tNow } from "../../../stores/language";

export interface ProjectOption {
	/** Directory the probe runs in. */
	path: string;
	label: string;
	/** Workspace to file a new session under (null for an ad-hoc cwd). */
	workspaceId: string | null;
	universal: boolean;
}

/** Universal (the global workspace) first, then registered projects; duplicate paths collapse. */
export function projectOptions(workspaces: readonly Workspace[], extraCwd?: string | null): ProjectOption[] {
	const out: ProjectOption[] = [];
	const seen = new Set<string>();
	const push = (o: ProjectOption) => {
		if (seen.has(o.path)) return;
		seen.add(o.path);
		out.push(o);
	};
	for (const w of workspaces) {
		if (w.kind === "global") {
			push({ path: w.path, label: tNow("promptComposition.universalProject"), workspaceId: w.id, universal: true });
		}
	}
	const projects = workspaces
		.filter((w) => w.kind !== "global")
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
	for (const w of projects) {
		push({ path: w.path, label: `${w.name}（${w.path}）`, workspaceId: w.id, universal: false });
	}
	if (extraCwd) push({ path: extraCwd, label: tNow("promptComposition.currentSessionDir", { cwd: extraCwd }), workspaceId: null, universal: false });
	return out;
}

/** Requested cwd, else the last used one, else Universal, else the first option. */
export function pickInitialCwd(
	options: readonly ProjectOption[],
	requested: string | null,
	last: string | null,
): string | null {
	for (const want of [requested, last]) {
		if (want && options.some((o) => o.path === want)) return want;
	}
	return options.find((o) => o.universal)?.path ?? options[0]?.path ?? null;
}

export function sharePct(tokens: number, total: number): number {
	return total > 0 ? (tokens * 100) / total : 0;
}

/** "12.3k" / "842" — estimated token counts. */
export function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

export function nonEmptyCategories(comp: PromptComposition): PromptCategory[] {
	return comp.categories.filter((c) => c.items.length > 0);
}

/** Absolute paths of the rule files the composition was built from. */
export function ruleFilePaths(comp: PromptComposition): string[] {
	return (comp.categories.find((c) => c.id === "rules")?.items ?? []).map((i) => i.title);
}

function topItems(comp: PromptComposition, n: number): PromptItem[] {
	return comp.categories
		.flatMap((c) => c.items)
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, n);
}

/**
 * Prompt prefilled (never sent) into a new session by 「让 AI 帮我优化」: the composition summary,
 * relevant paths and the rule that nothing is changed without the user's consent.
 */
export function buildOptimizePrompt(comp: PromptComposition, projectLabel: string): string {
	const lines: string[] = [];
	lines.push("我想优化新会话一开始就占用的上下文（系统提示词构成）。请先阅读下面的分析，然后和我讨论怎么精简。");
	lines.push("");
	lines.push("【重要约定】在我明确同意之前，不要修改、移动或删除任何文件。先说明你打算改什么、为什么、预计省多少，我同意后再动手。");
	lines.push("");
	lines.push(`## 被分析的项目\n${projectLabel}\n目录：${comp.cwd}`);
	lines.push("");
	const ref =
		comp.reportedTokens != null ? `；OMP 自己报告的空会话占用约 ${comp.reportedTokens} tokens` : "";
	lines.push(`## 构成概览（估算共约 ${comp.totalTokens} tokens${ref}）`);
	lines.push(`估算方法：${comp.estimateNote}`);
	for (const c of nonEmptyCategories(comp)) {
		lines.push(
			`- ${c.label}：约 ${c.tokens} tokens（${sharePct(c.tokens, comp.totalTokens).toFixed(0)}%），${c.items.length} 项`,
		);
	}
	lines.push("");
	lines.push("## 最大的几项");
	for (const i of topItems(comp, 8)) {
		lines.push(`- ${i.title}${i.detail ? `（${i.detail}）` : ""}：约 ${i.tokens} tokens`);
	}
	if (comp.hints.length > 0) {
		lines.push("");
		lines.push("## 工具自动给出的优化线索");
		for (const h of comp.hints) lines.push(`- ${h.title}：${h.detail}`);
	}
	const rules = ruleFilePaths(comp);
	lines.push("");
	lines.push("## 相关文件路径");
	if (rules.length > 0) {
		lines.push("规则文件（会被注入每个新会话）：");
		for (const p of rules) lines.push(`- ${p}`);
	} else {
		lines.push("该项目没有加载规则文件。");
	}
	lines.push(`- MCP 服务器配置（可能存在）：${comp.cwd}/.omp/mcp.json 、~/.omp/agent/mcp.json`);
	lines.push("- Skills：可用 skill://<名称> 读取某个 skill，也可在应用「设置 → 插件 / Skills」里查看来源");
	lines.push("");
	lines.push("## 请你做的事");
	lines.push("1. 阅读上面列出的规则文件，找出重复、过时、只在特定场景才需要的内容。");
	lines.push("2. 给出一份按「省 token 多少 / 风险」排序的精简建议，并说明每条为什么安全。");
	lines.push("3. 逐条和我讨论；只有我说「可以改」之后，才修改对应文件，并告诉我改了哪里。");
	return lines.join("\n");
}
