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
import { tNow } from "../../../stores/language";

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
				description: tNow("memoryRules.agentsDescRoot"),
				starter: "# AGENTS.md\n\n",
			});
		}
		out.push({
			id: "agents-native",
			label: ".omp/AGENTS.md",
			path: `${base}/AGENTS.md`,
			kind: "agents",
			description: tNow("memoryRules.agentsDescNative"),
			starter: "# AGENTS.md\n\n",
		});
	} else {
		out.push({
			id: "agents-global",
			label: "AGENTS.md",
			path: `${base}/AGENTS.md`,
			kind: "agents",
			description: tNow("memoryRules.agentsDescGlobal"),
			starter: "# AGENTS.md\n\n",
		});
	}
	out.push(
		{
			id: "rules-md",
			label: scope === "project" ? ".omp/RULES.md" : "RULES.md",
			path: `${base}/RULES.md`,
			kind: "rules",
			description: scope === "project" ? tNow("memoryRules.rulesDescProject") : tNow("memoryRules.rulesDescGlobal"),
			starter: "# RULES\n\n",
		},
		{
			id: "append-system",
			label: scope === "project" ? ".omp/APPEND_SYSTEM.md" : "APPEND_SYSTEM.md",
			path: `${base}/APPEND_SYSTEM.md`,
			kind: "append",
			description: tNow("memoryRules.appendDesc"),
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
			description: tNow("memoryRules.ruleFileDesc"),
			starter: "",
		}));
}

/** Per-path content on disk; null = missing. */
export type RuleContents = Record<string, string | null | undefined>;

export type RuleStatusCode = "loading" | "missing" | "exists";

export interface RuleStatus {
	exists: boolean;
	code: RuleStatusCode;
	/** 已存在 / 未创建 / 读取中 */
	label: string;
	/** Extra caveat, e.g. shadowed by another file. */
	note: string | null;
}

export function ruleStatus(entry: RuleEntry, contents: RuleContents, tr: (key: string) => string = tNow): RuleStatus {
	const content = contents[entry.path];
	if (content === undefined) return { exists: false, code: "loading", label: tr("memoryRules.statusLoading"), note: null };
	if (content === null) return { exists: false, code: "missing", label: tr("memoryRules.statusMissing"), note: null };
	let note: string | null = null;
	if (entry.kind !== "append" && content.trim() === "") note = tr("memoryRules.noteEmpty");
	if (entry.id === "agents-root") {
		const native = Object.entries(contents).find(([p]) => p.endsWith("/.omp/AGENTS.md"))?.[1];
		if (native && native.trim() !== "") note = tr("memoryRules.noteShadowed");
	}
	return { exists: true, code: "exists", label: tr("memoryRules.statusExists"), note };
}
