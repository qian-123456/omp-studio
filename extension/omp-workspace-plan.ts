// omp-workspace plan mode (installed + loaded by the OMP Workspace app).
//
// omp's own `/plan` only exists in the TUI, so app (RPC) sessions get the same
// workflow from this extension:
// - `/plan [task]` enters plan mode: read-only tool set, worktree writes blocked
//   (`local://` planning artifacts allowed), the `plan` role model, and a
//   plan-mode system context injected every turn.
// - After each planning turn the newest `local://*-plan.md` is published to the
//   app through the `ompws-plan` status key (JSON), where the user reviews it.
// - `/plan-action enable|disable|approve|save|status|run …` is how the app switches plan mode and answers the review.
//   Switching is explicit and idempotent (no toggle): bare `/plan` only enables.
// State survives resume through a custom session entry.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type ModelLike = { provider: string; id: string; name?: string };
type ToolCallEvent = { toolName?: string; input?: Record<string, unknown> };
type ContextEvent = { messages?: unknown[] };
type ContextUsage = { percent?: number };
type Entry = { type?: string; customType?: string; data?: unknown };
type SettingsLike = {
	getModelRole?: (role: string) => string | undefined;
	get?: (key: string) => unknown;
	getPlansDirectory?: () => string | undefined;
};
type Ctx = {
	cwd: string;
	model?: ModelLike;
	agent?: { kind?: string };
	ui: { setStatus(key: string, text: string | undefined): void; notify(message: string, type?: string): void };
	models?: { resolve(spec: string): ModelLike | undefined };
	sessionManager?: {
		getEntries?: () => Entry[];
		getArtifactsDir?: () => string | null;
		getSessionId?: () => string | null;
	};
	localProtocolOptions?: { getArtifactsDir?: () => string | null; getSessionId?: () => string | null };
	getContextUsage?: () => ContextUsage | undefined;
	isIdle?: () => boolean;
	waitForIdle?: () => Promise<void>;
	compact?: (instructions?: string) => Promise<void>;
};
type Handler = (event: never, ctx: Ctx) => unknown;
type Pi = {
	on(event: string, handler: Handler): void;
	registerCommand(name: string, def: { description: string; handler: (args: string, ctx: Ctx) => Promise<void> }): void;
	getActiveTools(): string[];
	getAllTools(): { name: string }[];
	setActiveTools(names: string[]): Promise<void>;
	setModel(model: ModelLike): Promise<boolean>;
	getThinkingLevel(): string | undefined;
	setThinkingLevel(level: string): void;
	sendMessage(message: { customType: string; content: string; display: boolean }, options?: { triggerTurn?: boolean }): void;
	sendUserMessage(text: string): void;
	appendEntry(customType: string, data?: unknown): void;
	pi?: { Settings?: { instance?: SettingsLike } };
};

const STATUS_KEY = "ompws-plan";
const STATE_ENTRY = "ompws-plan-state";
const CONTEXT_TYPE = "ompws-plan-context";
const REMINDER_TYPE = "ompws-plan-reminder";
/** Same threshold as omp's plan review: above it "keep context" is refused. */
const KEEP_CONTEXT_MAX_PERCENT = 95;
/** Unanswered "write the plan" reminders per user message. */
const REMINDER_MAX = 1;

/** True when the latest assistant message in an agent_end event is a user abort. */
export function endedByAbort(messages: unknown): boolean {
	if (!Array.isArray(messages)) return false;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; stopReason?: string } | null;
		if (m && m.role === "assistant") return m.stopReason === "aborted";
	}
	return false;
}

/** Remind only when no plan file exists, reminders remain, and the user did not stop the turn. */
// `stop` and `toolUse` describe model outcomes, not a user stop. Keep the
// cancellation boundary at the latest assistant's `aborted` reason; an older
// abort must not suppress a later completed planning turn's reminder.
export function shouldRemind(found: boolean, reminders: number, messages: unknown): boolean {
	return !found && reminders < REMINDER_MAX && !endedByAbort(messages);
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const DEFAULT_TIER_ORDER = ["smol", "default", "slow"];
/** Tools kept while planning (intersected with what the session has). */
const PLAN_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"glob",
	"bash",
	"lsp",
	"web_search",
	"fetch",
	"ask",
	"task",
	"wait",
	"write",
	"edit",
	"mcp__codegraph_explore",
]);
/** Subagents that cannot write; `task` is refused for anything else while planning. */
const READ_ONLY_AGENTS = new Set(["scout", "explore"]);
/** Shell commands that change the working tree or system. Plan mode refuses them. */
const MUTATING_SHELL: RegExp[] = [
	/(^|[\s;&|(])(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|shred|tee)\s/,
	/\bsed\s+(-[a-zA-Z]*i|--in-place)/,
	/\bgit\s+(add|commit|push|pull|reset|checkout|switch|merge|rebase|stash|apply|am|cherry-pick|revert|tag|clean|restore|rm|mv|init|clone|worktree\s+(add|remove))\b/,
	/\bgit\s+branch\s+-[dDmM]/,
	/\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|rm|uninstall|update|upgrade|link|publish|dlx|create)\b/,
	/\b(pip3?|uv|cargo|brew|apt(-get)?|gem|go)\s+(install|uninstall|add|remove)\b/,
	/\bsudo\b/,
	// Output redirection into a file (fd duplication and /dev/null are fine).
	/(^|[^0-9&>])>{1,2}\s*(?!&|\/dev\/null\b)[^\s|&;]/,
];

type Tier = { role: string; spec: string };
type Saved = {
	enabled: boolean;
	prevTools?: string[];
	prevModel?: string;
	prevThinking?: string;
	planFile?: string;
	version: number;
	lastContent?: string;
	prevContent?: string;
	phase: "planning" | "review";
};

const PLAN_CONTEXT = (planUrl: string | undefined, hasTask: boolean) => `<critical>
Plan mode active (OMP Workspace).
- Working tree and system are read-only: NEVER create, edit, delete, or rename working-tree files; NEVER run state-changing commands (\`git commit\`, \`pnpm install\`, migrations, redirects into files) or otherwise change the system. Such tool calls are refused.
- \`local://\`: session-local planning artifacts; MAY create/update them.
- Canonical plan: MUST write ${planUrl ? `\`${planUrl}\` (existing plan — read it and update it incrementally with \`edit\`)` : "`local://<slug>-plan.md` (short kebab-case `<slug>`, e.g. `local://auth-token-refresh-plan.md`) with `write`, then refine it with `edit`"}.
- The user reviews the plan file in the app's plan panel after your turn ends and picks how to execute it. NEVER ask the user to exit plan mode or to approve in prose; finishing the plan file IS the request for approval.
- Do not use \`todo\`: it is an execution checklist, not a plan.${hasTask ? "" : "\n- `task`: only read-only agents (`scout`/`explore`)."}
</critical>

## What a plan is

Plan: execution spec, not design doc. Approval may clear or compact the conversation; another engineer or a fresh agent implements solely from the file. A competent implementer unfamiliar with the conversation MUST be able to execute it top-to-bottom with ZERO design decisions.

## Ground every claim

Resolve unknowns by discovery (\`grep\`, \`find\`, \`read\`, code-intelligence tools), not questions. Every asserted path, symbol, signature, behavior: actually read this session; otherwise mark it inline \`unverified — confirm first\`. Preferences and tradeoffs that code cannot answer: record them under Assumptions with a recommended default and proceed. The user can annotate the plan and send corrections; treat such messages as edits to make in the plan file.

## Plan contents

Scannable markdown with \`##\` sections; depth follows the change.
- **Context** — literal ask, need, intended end state; 2–4 sentences.
- **Approach** — ordered, load-bearing change steps grouped by behavior: exact targets, reused utilities, exact new signatures/literals, every callsite of renames/removals, error/empty handling.
- **Critical files & anchors** — ≤5 files with symbol/region and one-line reason.
- **Verification** — end-to-end proof with exact commands and an observable new-behavior check.
- **Assumptions & contingencies** — only user-overridable decisions, each with its default and fallback.

NEVER include Non-Goals, Alternatives Considered, Risks/Mitigations, Future Work, or mechanical cleanup steps. NEVER reference the planning conversation ("as discussed").

<critical>
End the turn only when the plan file is decision-complete (or after recording open preferences as Assumptions). Write findings into the plan file as you learn them; NEVER defer all writing to the end.
</critical>`;

const PLAN_REMINDER = `<system-reminder>
Plan mode turn ended without a plan file. Write the plan to \`local://<slug>-plan.md\` now (record open questions as Assumptions with recommended defaults). Do not answer in plain text only.
</system-reminder>`;

const COMPACT_INSTRUCTIONS = (planFile: string) => `Prepare to execute approved plan.

MUST distill plan-mode discussion.
Preserve: plan rationale and explicitly rejected alternatives; key decisions and driving constraints; discovered files, symbols, code paths the executor needs; user preferences expressed during planning.
Drop: tool-call noise already captured in the plan; superseded plan drafts; context restated in the plan file.

Approved plan file: \`${planFile}\`; authoritative source of truth. MUST preserve this durable path; the plan body is re-inlined for the executor after compaction, so NEVER restate it in the summary.`;

const APPROVED_PROMPT = (planFile: string, content: string, contextPreserved: boolean, todo: boolean) =>
	[
		"Plan approved.",
		contextPreserved ? "- History usable; the plan below is authoritative if it conflicts with earlier exploration.\n" : "",
		"<instruction>",
		`Full plan inlined below; durable copy at \`${planFile}\` (identical content).`,
		"Execute the plan step-by-step with full tool access; MUST verify each step before the next.",
		`NEVER re-read \`${planFile}\` while the inline plan is intact; the path is for subagent handoff and recovery only.`,
		todo ? "Before execution: initialize todo tracking with `todo`. After each completed step: immediately update `todo`." : "",
		"</instruction>",
		"",
		`<plan path="${planFile}">`,
		content.trim(),
		"</plan>",
		"",
		"<critical>",
		`Inline plan compressed, expired, or unrecoverable: NEVER stop; read \`${planFile}\`. Read failure: report the exact path and error; NEVER guess.`,
		"MUST continue until complete.",
		"</critical>",
	]
		.filter((l) => l !== "")
		.join("\n");

function settingsOf(pi: Pi): SettingsLike | undefined {
	try {
		return pi.pi?.Settings?.instance;
	} catch {
		return undefined;
	}
}

/** `provider/id:level` → model part + optional thinking level. */
function splitSpec(spec: string): { model: string; thinking?: string } {
	const i = spec.lastIndexOf(":");
	if (i > 0 && THINKING_LEVELS.has(spec.slice(i + 1))) return { model: spec.slice(0, i), thinking: spec.slice(i + 1) };
	return { model: spec };
}

function roleSpec(pi: Pi, role: string): string | undefined {
	try {
		const spec = settingsOf(pi)?.getModelRole?.(role);
		return typeof spec === "string" && spec.trim() ? spec.trim() : undefined;
	} catch {
		return undefined;
	}
}

function modelKey(m: ModelLike | undefined): string | undefined {
	return m ? `${m.provider}/${m.id}` : undefined;
}

async function applySpec(pi: Pi, ctx: Ctx, spec: string): Promise<boolean> {
	const { model, thinking } = splitSpec(spec);
	const target = ctx.models?.resolve(model);
	if (!target) return false;
	if (modelKey(target) !== modelKey(ctx.model)) {
		if (!(await pi.setModel(target))) return false;
	}
	if (thinking) pi.setThinkingLevel(thinking);
	return true;
}

/** Mirror of omp's `resolveLocalRoot` (internal-urls/local-protocol.ts). */
function localRoot(ctx: Ctx): string {
	const lp = ctx.localProtocolOptions;
	const artifacts = lp?.getArtifactsDir?.() ?? ctx.sessionManager?.getArtifactsDir?.() ?? null;
	if (artifacts) return resolve(artifacts, "local");
	const raw = lp?.getSessionId?.() ?? ctx.sessionManager?.getSessionId?.() ?? "session";
	const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "_");
	return join(tmpdir(), "omp-local", safe && safe !== "." && safe !== ".." ? safe : "session");
}

/** Newest `*-plan.md` (or `PLAN.md`) under the local root. */
function newestPlanFile(ctx: Ctx): string | undefined {
	const root = localRoot(ctx);
	let best: { path: string; mtime: number } | undefined;
	const walk = (dir: string, depth: number) => {
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			const p = join(dir, name);
			let st;
			try {
				st = statSync(p);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				if (depth < 2) walk(p, depth + 1);
			} else if (/(^|-)plan\.md$/i.test(name) && (!best || st.mtimeMs > best.mtime)) {
				best = { path: p, mtime: st.mtimeMs };
			}
		}
	};
	walk(root, 0);
	return best?.path;
}

function readText(path: string | undefined): string | undefined {
	if (!path) return undefined;
	try {
		const text = readFileSync(path, "utf8");
		return text.trim() ? text : undefined;
	} catch {
		return undefined;
	}
}

function localUrl(ctx: Ctx, file: string): string {
	const rel = file.startsWith(localRoot(ctx)) ? file.slice(localRoot(ctx).length + 1) : basename(file);
	return `local://${rel.split("\\").join("/")}`;
}

function planTitle(content: string, file: string): string {
	const h = content.match(/^#\s+(.+)$/m);
	return (h?.[1] ?? basename(file).replace(/\.md$/i, "")).trim();
}

function targetPaths(toolName: string, input: Record<string, unknown>): string[] | null {
	const out: string[] = [];
	if (typeof input.path === "string") out.push(input.path);
	if (typeof input.file === "string") out.push(input.file);
	if (toolName === "edit" && typeof input.input === "string") {
		for (const m of input.input.matchAll(/^\[(.+?)#[0-9A-Za-z]{2,8}\]\s*$/gm)) out.push(m[1]);
	}
	if (Array.isArray(input.edits)) {
		for (const e of input.edits) {
			if (e && typeof e === "object" && typeof (e as Record<string, unknown>).path === "string") {
				out.push((e as Record<string, string>).path);
			}
		}
	}
	return out.length > 0 ? [...new Set(out)] : null;
}

function refusal(toolName: string, input: Record<string, unknown>): string | undefined {
	if (toolName === "write" || toolName === "edit") {
		const paths = targetPaths(toolName, input);
		if (!paths) return "Plan mode: could not determine the target file; only local:// planning files may be written.";
		const bad = paths.filter((p) => !p.startsWith("local://"));
		if (bad.length) return `Plan mode: the working tree is read-only. Write the plan to local://<slug>-plan.md instead (refused: ${bad.join(", ")}).`;
		return undefined;
	}
	if (toolName === "bash") {
		const cmd = typeof input.command === "string" ? input.command : "";
		if (MUTATING_SHELL.some((re) => re.test(cmd))) {
			return `Plan mode: state-changing shell commands are refused until the plan is approved.\nCommand: ${cmd}`;
		}
		return undefined;
	}
	if (toolName === "task") {
		const agents: string[] = [];
		if (typeof input.agent === "string") agents.push(input.agent);
		if (Array.isArray(input.tasks)) {
			for (const t of input.tasks) {
				const a = t && typeof t === "object" ? (t as Record<string, unknown>).agent : undefined;
				agents.push(typeof a === "string" ? a : "task");
			}
		}
		if (agents.length === 0 || agents.some((a) => !READ_ONLY_AGENTS.has(a))) {
			return "Plan mode: only read-only subagents (scout/explore) may be spawned.";
		}
		return undefined;
	}
	if (!PLAN_TOOLS.has(toolName)) return `Plan mode: \`${toolName}\` is unavailable until the plan is approved.`;
	return undefined;
}

export default function planMode(pi: Pi) {
	// The terminal view resumes the same session in omp's TUI, which ships its own
	// `/plan`; only app RPC sessions need this one. `plan.enabled: false` turns it off.
	const argv = process.argv;
	const rpc = argv.includes("--mode=rpc") || argv.some((a, i) => a === "--mode" && argv[i + 1] === "rpc");
	if (!rpc || settingsOf(pi)?.get?.("plan.enabled") === false) return;
	let s: Saved = { enabled: false, version: 0, phase: "planning" };
	let reminders = 0;
	let isSub = false;

	const persist = () => pi.appendEntry(STATE_ENTRY, s);

	const tiers = (): Tier[] => {
		const order = settingsOf(pi)?.get?.("cycleOrder");
		const roles = Array.isArray(order) && order.every((r) => typeof r === "string") ? (order as string[]) : DEFAULT_TIER_ORDER;
		const out: Tier[] = [];
		for (const role of roles) {
			const spec = roleSpec(pi, role);
			if (spec && !out.some((t) => t.role === role)) out.push({ role, spec });
		}
		return out;
	};

	const publish = (ctx: Ctx) => {
		if (isSub) return;
		if (!s.enabled) {
			ctx.ui.setStatus(STATUS_KEY, JSON.stringify({ v: 1, enabled: false }));
			return;
		}
		const pct = ctx.getContextUsage?.()?.percent;
		const content = s.lastContent;
		ctx.ui.setStatus(
			STATUS_KEY,
			JSON.stringify({
				v: 1,
				enabled: true,
				phase: content ? s.phase : "planning",
				planFile: s.planFile ?? null,
				planUrl: s.planFile ? localUrl(ctx, s.planFile) : null,
				title: content && s.planFile ? planTitle(content, s.planFile) : null,
				content: content ?? null,
				prevContent: s.prevContent ?? null,
				version: s.version,
				planModel: roleSpec(pi, "plan") ?? null,
				tiers: tiers(),
				defaultRole: "default",
				contextPercent: typeof pct === "number" ? Math.round(pct * 10) / 10 : null,
				keepDisabled: typeof pct === "number" && pct > KEEP_CONTEXT_MAX_PERCENT,
			}),
		);
	};

	/** Re-read the plan file; a changed body becomes a new review version. */
	const refreshPlan = (ctx: Ctx): boolean => {
		const file = (s.planFile && existsSync(s.planFile) ? s.planFile : undefined) ?? newestPlanFile(ctx);
		const content = readText(file);
		if (!file || !content) return false;
		s.planFile = file;
		if (content !== s.lastContent) {
			if (s.lastContent) s.prevContent = s.lastContent;
			s.lastContent = content;
			s.version += 1;
		}
		s.phase = "review";
		return true;
	};

	const enter = async (ctx: Ctx) => {
		const active = pi.getActiveTools();
		const available = new Set(pi.getAllTools().map((t) => t.name));
		s = {
			enabled: true,
			prevTools: active,
			prevModel: modelKey(ctx.model),
			prevThinking: pi.getThinkingLevel(),
			version: 0,
			phase: "planning",
		};
		reminders = 0;
		await pi.setActiveTools([...PLAN_TOOLS].filter((n) => available.has(n)));
		const spec = roleSpec(pi, "plan");
		if (spec && !(await applySpec(pi, ctx, spec))) ctx.ui.notify(`Plan model ${spec} is unavailable; planning with the current model.`, "warning");
		persist();
		publish(ctx);
	};

	/** Restore tools; `restoreModel` puts back the pre-plan model (execution role picks its own). */
	const exit = async (ctx: Ctx, restoreModel: boolean) => {
		const prev = s;
		s = { enabled: false, version: 0, phase: "planning" };
		const available = new Set(pi.getAllTools().map((t) => t.name));
		const tools = (prev.prevTools ?? []).filter((n) => available.has(n));
		if (!tools.includes("read") && available.has("read")) tools.push("read");
		if (tools.length) await pi.setActiveTools(tools);
		if (restoreModel && prev.prevModel) {
			await applySpec(pi, ctx, prev.prevThinking ? `${prev.prevModel}:${prev.prevThinking}` : prev.prevModel);
		}
		persist();
		publish(ctx);
		return prev;
	};

	pi.on("session_start", async (_e: never, ctx: Ctx) => {
		isSub = ctx.agent?.kind === "sub";
		if (isSub) return;
		const entries = ctx.sessionManager?.getEntries?.() ?? [];
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (e.type === "custom" && e.customType === STATE_ENTRY && e.data && typeof e.data === "object") {
				s = { version: 0, phase: "planning", ...(e.data as Partial<Saved>), enabled: (e.data as Saved).enabled === true };
				break;
			}
		}
		if (s.enabled) {
			const available = new Set(pi.getAllTools().map((t) => t.name));
			await pi.setActiveTools([...PLAN_TOOLS].filter((n) => available.has(n)));
			refreshPlan(ctx);
		}
		publish(ctx);
	});

	pi.on("tool_call", (event: never) => {
		if (!s.enabled || isSub) return undefined;
		const { toolName = "", input = {} } = event as ToolCallEvent;
		const reason = refusal(toolName, input);
		return reason ? { block: true, reason } : undefined;
	});

	pi.on("before_agent_start", (_e: never, ctx: Ctx) => {
		if (!s.enabled || isSub) return undefined;
		if (s.phase !== "planning") {
			s.phase = "planning";
			publish(ctx);
		}
		const url = s.planFile && existsSync(s.planFile) ? localUrl(ctx, s.planFile) : undefined;
		return {
			message: {
				customType: CONTEXT_TYPE,
				content: PLAN_CONTEXT(url, false),
				display: false,
			},
		};
	});

	// Only the newest plan-mode context reaches the model; none once plan mode ends.
	pi.on("context", (event: never) => {
		const messages = (event as ContextEvent).messages;
		if (!Array.isArray(messages)) return undefined;
		const isCtx = (m: unknown) =>
			!!m && typeof m === "object" && [CONTEXT_TYPE, REMINDER_TYPE].includes(String((m as Record<string, unknown>).customType));
		let last = -1;
		if (s.enabled) {
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i] as Record<string, unknown>;
				if (isCtx(m) && m.customType === CONTEXT_TYPE) {
					last = i;
					break;
				}
			}
		}
		if (!messages.some(isCtx)) return undefined;
		return { messages: messages.filter((m, i) => !isCtx(m) || i === last || (s.enabled && i > last)) };
	});

	pi.on("input", () => {
		reminders = 0;
		return undefined;
	});

	pi.on("agent_end", (e: { messages?: unknown }, ctx: Ctx) => {
		if (!s.enabled || isSub) return;
		const found = refreshPlan(ctx);
		persist();
		publish(ctx);
		if (shouldRemind(found, reminders, e?.messages)) {
			reminders += 1;
			pi.sendMessage({ customType: REMINDER_TYPE, content: PLAN_REMINDER, display: false }, { triggerTurn: true });
		}
	});

	pi.registerCommand("plan", {
		description: "Plan mode: read-only planning, then review and approve the plan (/plan [task])",
		handler: async (args, ctx) => {
			if (isSub) return;
			const task = args.trim();
			if (!task) {
				if (s.enabled) ctx.ui.notify("Plan mode is already on");
				else {
					await enter(ctx);
					ctx.ui.notify("Plan mode on");
				}
				return;
			}
			if (!s.enabled) await enter(ctx);
			pi.sendUserMessage(task);
		},
	});

	pi.registerCommand("plan-action", {
		description: "OMP Workspace plan actions (enable/disable/approve/save/status/run)",
		handler: async (args, ctx) => {
			if (isSub) return;
			const [action = "", ...rest] = args.trim().split(/\s+/);
			if (action === "status") {
				if (s.enabled) refreshPlan(ctx);
				publish(ctx);
				return;
			}
			if (action === "enable") {
				if (!s.enabled) await enter(ctx);
				else publish(ctx);
				return;
			}
			if (action === "disable") {
				if (s.enabled) {
					await ctx.waitForIdle?.();
					await exit(ctx, true);
				} else publish(ctx);
				return;
			}
			if (action === "run") {
				// `/plan-action run [@role] <file>`: execute an approved plan in a fresh session.
				const role = rest[0]?.startsWith("@") ? rest.shift()?.slice(1) : undefined;
				const file = rest.join(" ");
				const content = readText(file);
				if (!content) {
					ctx.ui.notify(`Plan file not found: ${file}`, "error");
					return;
				}
				const spec = role ? roleSpec(pi, role) : undefined;
				if (spec && !(await applySpec(pi, ctx, spec))) ctx.ui.notify(`Model for role ${role} is unavailable; keeping the current model.`, "warning");
				pi.sendUserMessage(APPROVED_PROMPT(file, content, false, pi.getActiveTools().includes("todo")));
				return;
			}
			if (!s.enabled) {
				ctx.ui.notify("Plan mode is not active.", "warning");
				publish(ctx);
				return;
			}
			await ctx.waitForIdle?.();
			refreshPlan(ctx);
			const file = s.planFile;
			const content = readText(file);
			if (action === "save") {
				if (!file || !content) {
					ctx.ui.notify("No plan file to save yet.", "error");
					return;
				}
				const dir = settingsOf(pi)?.getPlansDirectory?.() || join(homedir(), ".omp", "plans");
				const stamp = new Date().toISOString().slice(0, 10);
				const dest = join(dir, `${stamp}-${basename(file)}`);
				mkdirSync(dirname(dest), { recursive: true });
				copyFileSync(file, dest);
				await exit(ctx, true);
				ctx.ui.notify(`Plan saved to ${dest}`);
				return;
			}
			if (action !== "approve") {
				ctx.ui.notify(`Unknown plan action: ${action}`, "error");
				return;
			}
			const [how = "execute", role] = rest;
			if (!file || !content) {
				ctx.ui.notify("No plan file to approve yet.", "error");
				return;
			}
			const usage = ctx.getContextUsage?.()?.percent;
			if (how === "keep" && typeof usage === "number" && usage > KEEP_CONTEXT_MAX_PERCENT) {
				ctx.ui.notify(`Context is ${Math.round(usage)}% full; compact or start fresh instead.`, "error");
				return;
			}
			const spec = role ? roleSpec(pi, role) : undefined;
			await exit(ctx, !spec);
			// "execute" starts a fresh session in the app (`/plan-action run <file>` there).
			if (how === "execute") return;
			if (spec && !(await applySpec(pi, ctx, spec))) ctx.ui.notify(`Model for role ${role} is unavailable; keeping the current model.`, "warning");
			if (how === "compact") {
				// A tiny session has nothing to compact; the plan still executes with history kept.
				try {
					await ctx.compact?.(COMPACT_INSTRUCTIONS(file));
				} catch (err) {
					ctx.ui.notify(`Compaction skipped: ${err instanceof Error ? err.message : String(err)}`, "warning");
				}
			}
			pi.sendUserMessage(APPROVED_PROMPT(file, content, true, pi.getActiveTools().includes("todo")));
		},
	});
}
