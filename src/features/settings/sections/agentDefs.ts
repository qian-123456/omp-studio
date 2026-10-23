/**
 * Pure helpers for the SubAgent prompt and definition files (agents/*.md).
 * OMP loads agent definitions from:
 * - Global: `~/.omp/agent/agents/<name>.md`
 * - Project: `<cwd>/.omp/agents/<name>.md`
 */

export type AgentScope = "global" | "project";

export interface BuiltinAgentDef {
	name: string;
	label: string;
	description: string;
	starter: string;
}

export const BUILTIN_AGENTS: readonly BuiltinAgentDef[] = [
	{
		name: "scout",
		label: "scout.md",
		description: "代码库探索、快速分析与广泛模式检索（只读快速探针）",
		starter: `---
name: scout
description: "MUST be used for exploratory codebase research, rapid code analysis, and broad pattern searches. Fast read-only scout returning compressed context for handoff."
tools:
  - find
  - read
  - grep
  - glob
  - web_search
  - yield
model:
  - "@scout"
thinkingLevel: low
---

代码库探索与信息检索专家。
`,
	},
	{
		name: "task",
		label: "task.md",
		description: "通用多步骤执行代理，具备全部工具权限",
		starter: `---
name: task
description: General-purpose subagent with full capabilities for delegated multi-step tasks
tools:
  - "*"
model:
  - "@task"
---

通用多步骤任务执行代理。
`,
	},
	{
		name: "reviewer",
		label: "reviewer.md",
		description: "代码评审专家，负责质量与安全性分析",
		starter: `---
name: reviewer
description: Code review specialist for quality/security analysis
tools:
  - read
  - grep
  - glob
  - bash
  - lsp
  - web_search
  - ast_grep
  - yield
spawns:
  - scout
model:
  - "@reviewer"
---

代码审查专家。
`,
	},
	{
		name: "security-reviewer",
		label: "security-reviewer.md",
		description: "安全专项漏洞审查专家",
		starter: `---
name: security-reviewer
description: Read-only security specialist for evidence-backed repository vulnerability discovery
tools:
  - read
  - grep
  - glob
  - lsp
  - ast_grep
  - yield
model:
  - "@security-reviewer"
---

代码安全专项审查。
`,
	},
	{
		name: "sonic",
		label: "sonic.md",
		description: "轻量机械化改动或数据提取代理",
		starter: `---
name: sonic
description: Low-reasoning agent for strictly mechanical updates or data collection only
model:
  - "@smol"
thinkingLevel: medium
---

轻量执行代理。
`,
	},
	{
		name: "tester",
		label: "tester.md",
		description: "自动化测试与验证专家",
		starter: `---
name: tester
description: Automated testing and verification specialist
tools:
  - read
  - edit
  - write
  - bash
  - grep
  - glob
model:
  - "@tester"
---

测试与验证专家。
`,
	},
] as const;

function trimSlash(dir: string): string {
	return dir.length > 1 ? dir.replace(/\/+$/, "") : dir;
}

export function agentBaseDir(scope: AgentScope, home: string | null, cwd: string | null): string | null {
	if (scope === "global") return home ? `${trimSlash(home)}/.omp/agent` : null;
	return cwd ? `${trimSlash(cwd)}/.omp` : null;
}

export function agentsDirPath(scope: AgentScope, home: string | null, cwd: string | null): string | null {
	const base = agentBaseDir(scope, home, cwd);
	return base ? `${base}/agents` : null;
}

export interface AgentEntry {
	id: string;
	name: string;
	label: string;
	path: string;
	description: string;
	isBuiltin: boolean;
	starter: string;
}

export function isAgentFileName(name: string): boolean {
	return !name.startsWith(".") && name.endsWith(".md");
}

export function isValidAgentName(name: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(name) && !name.startsWith(".");
}

/** omp rejects `main` and `sub` (checked case-insensitively after trimming). */
function isReservedAgentName(name: string): boolean {
	const lower = name.toLowerCase();
	return lower === "main" || lower === "sub";
}

/** Tools of the "只读" preset: look things up, never change files or run commands. */
export const READONLY_AGENT_TOOLS: readonly string[] = ["read", "grep", "glob", "find", "web_search"];

/** Everything the 「新建子代理」 form collects. `null` fields are left out of the file. */
export interface NewAgentSpec {
	name: string;
	/** One line: what it does and when to dispatch it. The main agent decides from this alone. */
	description: string;
	/** Body of the file: the subagent's own system prompt. */
	prompt: string;
	/** `null` = omp's default toolset (no `tools:` key). */
	tools: readonly string[] | null;
	/** `@role` or `provider/model[:level]`; `null` = follow the parent session. */
	model: string | null;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Validate a new subagent name against omp's rules and the names this list already shows. */
export function checkNewAgentName(raw: string, taken: ReadonlySet<string>): NameCheck {
	const name = raw.trim();
	if (!name) return { ok: false, error: "请填写子代理的名字" };
	if (!isValidAgentName(name)) return { ok: false, error: "名字只能包含英文字母、数字、中划线和下划线" };
	if (isReservedAgentName(name)) return { ok: false, error: `「${name}」是 OMP 保留的名字，请换一个` };
	if (taken.has(name)) return { ok: false, error: `已有子代理「${name}」，请在下方列表里直接修改它` };
	return { ok: true, name };
}

export interface AgentToolOption {
	name: string;
	/** What the tool lets the subagent do, in everyday words. */
	label: string;
}

/**
 * omp built-in tools a subagent can be limited to (names from omp's `docs/tools/*.md`), grouped for
 * the 「自己选」 picker. MCP, extension and custom tools are always added on top by omp, so they
 * are not listed. Re-check against `omp://tools/` after an omp upgrade.
 */
export const AGENT_TOOL_GROUPS: readonly { title: string; tools: readonly AgentToolOption[] }[] = [
	{
		title: "查看与搜索",
		tools: [
			{ name: "read", label: "读取文件和网页" },
			{ name: "grep", label: "按文字搜索文件内容" },
			{ name: "glob", label: "按文件名找文件" },
			{ name: "find", label: "用描述找代码位置" },
			{ name: "ast_grep", label: "按代码结构搜索" },
			{ name: "lsp", label: "查定义、引用和报错" },
		],
	},
	{
		title: "修改文件",
		tools: [
			{ name: "edit", label: "修改已有文件" },
			{ name: "write", label: "新建或覆盖文件" },
			{ name: "ast_edit", label: "按代码结构批量改写" },
		],
	},
	{
		title: "运行",
		tools: [
			{ name: "bash", label: "运行命令行" },
			{ name: "eval", label: "运行 Python / JS 代码" },
			{ name: "debug", label: "用调试器调试程序" },
		],
	},
	{
		title: "联网",
		tools: [
			{ name: "web_search", label: "网页搜索" },
			{ name: "github", label: "操作 GitHub 仓库和 PR" },
		],
	},
	{
		title: "协作",
		tools: [
			{ name: "task", label: "再派自己的子代理" },
			{ name: "wait", label: "等待后台任务结果" },
			{ name: "todo", label: "维护任务清单" },
		],
	},
];

const TOOL_ORDER = AGENT_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name));

/** The picked tools in catalog order, so the written file does not depend on click order. */
export function orderPickedTools(picked: ReadonlySet<string>): string[] {
	return TOOL_ORDER.filter((name) => picked.has(name));
}

/**
 * Render the agent file omp discovers (`agents/<name>.md`). Strings go through JSON quoting,
 * which is a valid YAML double-quoted scalar, so colons, quotes and `#` survive.
 */
export function buildAgentFile(spec: NewAgentSpec): string {
	const lines = ["---", `name: ${spec.name}`, `description: ${JSON.stringify(spec.description.trim())}`];
	if (spec.tools !== null) {
		if (spec.tools.length === 0) lines.push("tools: []");
		else lines.push("tools:", ...spec.tools.map((t) => `  - ${JSON.stringify(t)}`));
	}
	if (spec.model) lines.push(`model: ${JSON.stringify(spec.model)}`);
	lines.push("---", "", spec.prompt.trim(), "");
	return lines.join("\n");
}

function describeTools(tools: readonly string[] | null): string {
	if (tools === null) return "默认全部工具（不写 tools）";
	return tools.length === 0 ? "不给任何内置工具" : tools.join(", ");
}

/**
 * First message for the 「让 AI 帮我写」 session: whatever the user already filled in, the target
 * file, and the exact file format, so the AI asks for the rest and writes a file omp accepts.
 */
export function buildAgentDraftPrompt(spec: Partial<NewAgentSpec>, opts: { dir: string; scopeLabel: string }): string {
	const name = spec.name?.trim() ?? "";
	const missing = "（还没想好）";
	const lines = [
		"帮我设计并创建一个 OMP 子代理（subagent）。创建好以后，主 AI 派发任务时可以用 task 工具直接调用它，就像内置的 task、scout 一样。",
		"",
		`要写入的文件：${opts.dir}/${name || "<名字>"}.md（${opts.scopeLabel}）。如果这个文件已经存在，先告诉我，不要覆盖。`,
		"",
		"我目前的想法：",
		`- 名字：${name || missing}`,
		`- 负责什么、什么时候该派它：${spec.description?.trim() || missing}`,
		`- 工作要求：${spec.prompt?.trim() || missing}`,
		`- 可用工具：${spec.tools === undefined ? missing : describeTools(spec.tools)}`,
		`- 模型：${spec.model === undefined ? missing : (spec.model ?? "跟随主会话（不写 model）")}`,
		"",
		"请按这个流程来：",
		"1. 先问我缺少的关键信息，一次只问一个问题：它负责什么、主 AI 什么时候该派它、需要哪些工具、做完要交回什么。",
		"2. 把完整的文件内容给我确认，我同意后再写入上面的文件。",
		"",
		"文件格式（YAML 头 + 正文）：",
		"```md",
		"---",
		"name: <名字：只用英文字母、数字、- 和 _，不能叫 main 或 sub>",
		'description: "<一句话说清负责什么、什么时候该派它；主 AI 只看这句话决定要不要派它>"',
		"tools: <可选；不写就是默认全部工具；只读示例：[read, grep, glob, find, web_search]>",
		'model: "<可选；@角色名 表示复用模型角色，或 provider/model[:思考等级]；不写就跟随主会话>"',
		"---",
		"",
		"<正文：这个子代理自己的系统提示词，写清楚工作方式、边界和交回结果的格式>",
		"```",
	];
	return lines.join("\n");
}

export function buildAgentEntries(dir: string, diskNames: string[]): AgentEntry[] {
	const diskSet = new Set(diskNames.filter(isAgentFileName));
	const entries: AgentEntry[] = [];

	// 1. Built-in agents in canonical order
	for (const b of BUILTIN_AGENTS) {
		const filename = `${b.name}.md`;
		diskSet.delete(filename);
		entries.push({
			id: b.name,
			name: b.name,
			label: b.label,
			path: `${dir}/${filename}`,
			description: b.description,
			isBuiltin: true,
			starter: b.starter,
		});
	}

	// 2. Extra custom agent files on disk
	const remaining = Array.from(diskSet).sort();
	for (const filename of remaining) {
		const name = filename.replace(/\.md$/, "");
		entries.push({
			id: name,
			name,
			label: filename,
			path: `${dir}/${filename}`,
			description: "自定义子代理定义文件",
			isBuiltin: false,
			starter: `---\nname: ${name}\ndescription: 自定义子代理\n---\n\n`,
		});
	}

	return entries;
}

export type AgentContents = Record<string, string | null | undefined>;

/** Where an agent definition comes from. OMP uses the first one found: project, then global, then built-in. */
export type AgentLayer = "project" | "global" | "builtin";

export const AGENT_LAYER_LABEL: Record<AgentLayer, string> = {
	builtin: "内置版本",
	global: "全局版本",
	project: "项目版本",
};

export interface AgentLayerInfo {
	/** Layer OMP actually uses for this agent, or null when no definition exists anywhere. */
	active: AgentLayer | null;
	/** The selected layer has its own file for this agent. */
	hereExists: boolean;
	/** The selected layer's file exists but a higher layer wins (only project can shadow global). */
	shadowedBy: AgentLayer | null;
}

/**
 * Resolve which definition is in effect. Precedence is whole-file, first-wins by name:
 * project `.omp/agents` → user `~/.omp/agent/agents` → bundled. Nothing is merged.
 */
export function resolveAgentLayer(opts: {
	isBuiltin: boolean;
	scope: AgentScope;
	inGlobal: boolean;
	inProject: boolean;
	hasProject: boolean;
}): AgentLayerInfo {
	const { isBuiltin, scope, inGlobal, inProject, hasProject } = opts;
	const projectWins = hasProject && inProject;
	const active: AgentLayer | null = projectWins ? "project" : inGlobal ? "global" : isBuiltin ? "builtin" : null;
	const hereExists = scope === "global" ? inGlobal : inProject;
	const shadowedBy = scope === "global" && inGlobal && projectWins ? "project" : null;
	return { active, hereExists, shadowedBy };
}

export function extractFrontmatterSummary(content: string): {
	description?: string;
	model?: string;
	thinkingLevel?: string;
} {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const yaml = match[1];

	const descMatch = yaml.match(/^description:\s*(?:"([^"]*)"|'([^']*)'|([^\r\n]+))/m);
	const listModel = yaml.match(/^model:\s*\r?\n\s*-\s*["']?([^"'\r\n]+)["']?/m);
	const inlineModel = yaml.match(/^model:\s+["']?([^"'\r\n]+)["']?/m);
	const model = (listModel?.[1] ?? inlineModel?.[1])?.trim();
	const thinkingMatch = yaml.match(/^thinkingLevel:\s*["']?([a-zA-Z0-9_-]+)["']?/m);

	return {
		description: descMatch ? (descMatch[1] ?? descMatch[2] ?? descMatch[3])?.trim() : undefined,
		model: model && model !== "-" ? model : undefined,
		thinkingLevel: thinkingMatch ? thinkingMatch[1]?.trim() : undefined,
	};
}
