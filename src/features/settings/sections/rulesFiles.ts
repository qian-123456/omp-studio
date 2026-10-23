/**
 * Pure helpers for the 规则文件 page: which omp rule files exist where, and how
 * to describe them. Discovery paths (verified against omp 18.8.0 source,
 * discovery/builtin.ts + main.ts):
 * - AGENTS.md: global `~/.omp/agent/AGENTS.md`; project `<cwd>/.omp/AGENTS.md`
 *   (shadows) or `<cwd>/AGENTS.md`.
 * - RULES.md (always-apply rule): global `~/.omp/agent/RULES.md`; project ONLY `<cwd>/.omp/RULES.md`.
 * - rules/*.md|.mdc: global `~/.omp/agent/rules/`, project `<cwd>/.omp/rules/`.
 * - APPEND_SYSTEM.md: project `<cwd>/.omp/APPEND_SYSTEM.md` wins; else global
 *   `~/.omp/agent/APPEND_SYSTEM.md` (only one is used).
 */

export type RuleScope = "global" | "project";
export type RuleKind = "agents" | "rules" | "rule-file" | "append";

export interface RuleEntry {
	id: string;
	/** Short name shown in the list. */
	label: string;
	path: string;
	kind: RuleKind;
	/** One plain sentence on what the file does. */
	description: string;
	/** Content written by 「创建」. */
	starter: string;
}

function trimSlash(dir: string): string {
	return dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
}

/** Base dir holding RULES.md / rules/ / APPEND_SYSTEM.md for a scope, or null if unknown. */
export function ruleBaseDir(scope: RuleScope, home: string | null, cwd: string | null): string | null {
	if (scope === "global") return home ? `${trimSlash(home)}/.omp/agent` : null;
	return cwd ? `${trimSlash(cwd)}/.omp` : null;
}

export function rulesDirPath(scope: RuleScope, home: string | null, cwd: string | null): string | null {
	const base = ruleBaseDir(scope, home, cwd);
	return base ? `${base}/rules` : null;
}

const AGENTS_DESC = "写给 AI 的长期说明（项目约定、常用命令、注意事项），每个新会话都会带上。";
const RULES_DESC = "始终生效的规则：每次请求都会完整带上，长对话里也不会被冲淡。";
const APPEND_DESC = "追加到系统提示词末尾的内容。项目里有这个文件时，全局的会被忽略。";

/** The fixed files for a scope, in display order. */
export function buildRuleEntries(scope: RuleScope, home: string | null, cwd: string | null): RuleEntry[] {
	const base = ruleBaseDir(scope, home, cwd);
	if (!base) return [];
	const root = cwd ? trimSlash(cwd) : null;
	const out: RuleEntry[] = [];
	if (scope === "project") {
		if (root) {
			out.push({
				id: "agents-root",
				label: "AGENTS.md",
				path: `${root}/AGENTS.md`,
				kind: "agents",
				description: `${AGENTS_DESC}放在项目根目录。`,
				starter: "# AGENTS.md\n\n",
			});
		}
		out.push({
			id: "agents-native",
			label: ".omp/AGENTS.md",
			path: `${base}/AGENTS.md`,
			kind: "agents",
			description: `${AGENTS_DESC}两个位置都有内容时，omp 只读这一个。`,
			starter: "# AGENTS.md\n\n",
		});
	} else {
		out.push({
			id: "agents-global",
			label: "AGENTS.md",
			path: `${base}/AGENTS.md`,
			kind: "agents",
			description: AGENTS_DESC,
			starter: "# AGENTS.md\n\n",
		});
	}
	out.push(
		{
			id: "rules-md",
			label: scope === "project" ? ".omp/RULES.md" : "RULES.md",
			path: `${base}/RULES.md`,
			kind: "rules",
			description: scope === "project" ? `${RULES_DESC}项目里只认 .omp/RULES.md。` : RULES_DESC,
			starter: "# RULES\n\n",
		},
		{
			id: "append-system",
			label: scope === "project" ? ".omp/APPEND_SYSTEM.md" : "APPEND_SYSTEM.md",
			path: `${base}/APPEND_SYSTEM.md`,
			kind: "append",
			description: APPEND_DESC,
			starter: "",
		},
	);
	return out;
}

/** True for file names omp loads from a `rules/` dir. */
export function isRuleFileName(name: string): boolean {
	return !name.startsWith(".") && (name.endsWith(".md") || name.endsWith(".mdc"));
}

/** Entries for the files found inside the scope's `rules/` dir. */
export function buildRuleFileEntries(dir: string, names: string[]): RuleEntry[] {
	return names
		.filter(isRuleFileName)
		.sort((a, b) => a.localeCompare(b))
		.map((name) => ({
			id: `rule:${name}`,
			label: `rules/${name}`,
			path: `${trimSlash(dir)}/${name}`,
			kind: "rule-file" as const,
			description: "按场景触发的规则：写了触发条件（frontmatter）的，会在 AI 输出时实时检查，命中才生效。",
			starter: "",
		}));
}

/** Per-path content on disk; null = missing. */
export type RuleContents = Record<string, string | null | undefined>;

export interface RuleStatus {
	exists: boolean;
	/** 已存在 / 未创建 */
	label: string;
	/** Extra caveat, e.g. shadowed by another file. */
	note: string | null;
}

export function ruleStatus(entry: RuleEntry, contents: RuleContents): RuleStatus {
	const content = contents[entry.path];
	if (content === undefined) return { exists: false, label: "读取中", note: null };
	if (content === null) return { exists: false, label: "未创建", note: null };
	let note: string | null = null;
	if (entry.kind !== "append" && content.trim() === "") note = "内容为空，omp 会忽略";
	if (entry.id === "agents-root") {
		const native = Object.entries(contents).find(([p]) => p.endsWith("/.omp/AGENTS.md"))?.[1];
		if (native && native.trim() !== "") note = "被 .omp/AGENTS.md 覆盖，omp 不会读取";
	}
	return { exists: true, label: "已存在", note };
}
