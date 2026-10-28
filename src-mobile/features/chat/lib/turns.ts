/**
 * Turn grouping (mirrors desktop turnGrouping, lite): one user message + the assistant work that answers it.
 * Blocks keep object identity across rebuilds when their source rows did not change, so memoized rows skip re-render.
 */
import type { ImageRef, Item, ToolItem } from "../../../core/types";
import type { RequestStat } from "./requestStats";

export type Step =
	| { kind: "thinking"; key: string; text: string; /** Request duration of the row, ms (approximate thinking time). */ ms: number | null }
	| { kind: "text"; key: string; text: string }
	| { kind: "tool"; key: string; tool: ToolItem }
	| { kind: "stat"; key: string; itemId: string; stat: RequestStat }
	| { kind: "notice"; key: string; text: string };

export interface Answer {
	id: string;
	text: string;
	images: ImageRef[];
}

export interface Turn {
	type: "turn";
	id: string;
	user: Item | null;
	steps: Step[];
	answer: Answer | null;
	answerStat: { itemId: string; stat: RequestStat } | null;
	/** First / last timestamps in ms (0 when unknown). */
	start: number;
	end: number;
	/** Id of the last assistant row: target of retry/regenerate. */
	lastAssistantId: string | null;
	/** Source rows, compared by identity to reuse the previous Turn object. */
	src: readonly Item[];
}

export interface NoticeBlock {
	type: "notice";
	id: string;
	text: string;
	src: readonly Item[];
}

export type Block = Turn | NoticeBlock;

const PROTOCOL = new Set(["compaction", "branch_summary", "model_change", "custom", "system", "thinking_level_change"]);

export function noticeText(it: Item): string {
	switch (it.kind) {
		case "compaction":
			return "上下文已压缩";
		case "branch_summary":
			return "分支摘要";
		case "model_change":
			return `模型切换${it.text ? `：${it.text}` : ""}`;
		case "thinking_level_change":
			return `思考等级 → ${it.text || "?"}`;
		default:
			return (it.text || "").replace(/^<system-(?:notice|reminder)>|<\/system-(?:notice|reminder)>$/g, "").trim().slice(0, 200);
	}
}

const ms = (ts: string | null): number => (ts ? Date.parse(ts) || 0 : 0);

interface Draft {
	id: string;
	user: Item | null;
	/** Assistant rows and in-turn notices in arrival order. */
	entries: Item[];
	src: Item[];
	start: number;
	end: number;
}

function finalize(d: Draft, stats: Readonly<Record<string, RequestStat>>): Turn {
	let answer: Answer | null = null;
	let answerStat: Turn["answerStat"] = null;
	let last: Item | null = null;
	for (const it of d.entries) if (it.role === "assistant") last = it;
	const steps: Step[] = [];
	for (const it of d.entries) {
		if (it.role !== "assistant") {
			steps.push({ kind: "notice", key: `nt-${it.id}`, text: noticeText(it) });
			continue;
		}
		const isAnswer = it === last && it.text.trim() !== "";
		if (isAnswer) answer = { id: it.id, text: it.text, images: it.images };
		if (it.thinking) {
			const ms = stats[it.id]?.durationMs ?? null;
			steps.push({ kind: "thinking", key: `th-${it.id}`, text: it.thinking, ms });
		}
		if (it.text.trim() && !isAnswer && it.kind !== "bash") steps.push({ kind: "text", key: `tx-${it.id}`, text: it.text });
		if (it.kind === "bash") {
			steps.push({ kind: "tool", key: `bash-${it.id}`, tool: { id: it.id, name: "bash", args: it.text, status: "done", result: "" } });
		} else {
			for (const t of it.tools) steps.push({ kind: "tool", key: `tc-${t.id}`, tool: t });
		}
		const stat = stats[it.id];
		if (stat && isAnswer) answerStat = { itemId: it.id, stat };
		else if (stat) steps.push({ kind: "stat", key: `st-${it.id}`, itemId: it.id, stat });
	}
	return {
		type: "turn",
		id: d.id,
		user: d.user,
		steps,
		answer,
		answerStat,
		start: d.start,
		end: d.end,
		lastAssistantId: last ? last.id : null,
		src: d.src,
	};
}

export function buildBlocks(items: readonly Item[], stats: Readonly<Record<string, RequestStat>>): Block[] {
	const blocks: Block[] = [];
	let d: Draft | null = null;
	const fin = () => {
		if (d) blocks.push(finalize(d, stats));
		d = null;
	};
	const open = (user: Item | null, seed: Item): Draft => {
		const t = ms(seed.ts);
		return { id: `turn-${seed.id}`, user, entries: [], src: [], start: t, end: t };
	};
	const activityAfter = (i: number): boolean => {
		for (let j = i + 1; j < items.length; j++) {
			const n = items[j];
			if (n.role === "user") return false;
			if (n.role === "assistant") return true;
		}
		return false;
	};
	for (let i = 0; i < items.length; i++) {
		const it = items[i];
		if (it.role === "user") {
			fin();
			d = open(it, it);
			d.src.push(it);
		} else if (it.role === "assistant") {
			if (!d) d = open(null, it);
			d.entries.push(it);
			d.src.push(it);
			const t = ms(it.ts);
			if (t) d.end = t;
		} else if (PROTOCOL.has(it.kind)) {
			const text = noticeText(it);
			if (d && activityAfter(i)) {
				d.entries.push(it);
				d.src.push(it);
			} else {
				fin();
				if (text) blocks.push({ type: "notice", id: `notice-${it.id}`, text, src: [it] });
			}
		}
		// Orphan system rows carrying only a tool result are ignored (their result is attached by the merge step).
	}
	fin();
	return blocks;
}

function sameSrc(a: readonly Item[], b: readonly Item[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Reuse previous block objects whose sources are identical. */
export function reuseBlocks(prev: readonly Block[], next: Block[]): Block[] {
	if (!prev.length) return next;
	const byId = new Map<string, Block>();
	for (const b of prev) byId.set(b.id, b);
	let identical = prev.length === next.length;
	const out = next.map((b, i) => {
		const old = byId.get(b.id);
		const keep = old && old.type === b.type && sameSrc(old.src, b.src) ? old : b;
		if (keep !== prev[i]) identical = false;
		return keep;
	});
	return identical ? (prev as Block[]) : out;
}

/** Human duration like 「2 分 5 秒」 for fold labels. */
export function fmtDur(msec: number): string {
	if (!(msec > 0)) return "0 秒";
	const s = Math.round(msec / 1000);
	if (s < 60) return `${Math.max(1, s)} 秒`;
	const m = Math.floor(s / 60);
	if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分`;
	const h = Math.floor(m / 60);
	return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
}

/**
 * The one quiet line that stands for a turn's machine work. Tools → 「已运行 6 个步骤 · 57 秒」;
 * thinking only → 「已思考 12 秒」; running → 「正在运行 · 12 秒」.
 */
export function foldLabel(t: Pick<Turn, "steps" | "start" | "end">, running: boolean, now: number): string {
	if (running) return `正在运行 · ${fmtDur(now - (t.start || now))}`;
	const tools = t.steps.filter((s) => s.kind === "tool").length;
	const span = t.end > t.start && t.start ? t.end - t.start : 0;
	if (!tools && t.steps.some((s) => s.kind === "thinking")) {
		let ms = span;
		if (!ms) for (const s of t.steps) if (s.kind === "thinking" && s.ms) ms += s.ms;
		return ms ? `已思考 ${fmtDur(ms)}` : "已思考";
	}
	const n = tools || t.steps.filter((s) => s.kind !== "stat").length;
	return `已运行 ${n} 个步骤${span ? ` · ${fmtDur(span)}` : ""}`;
}

/** Thinking line label: 「已思考 12 秒」 when the request duration is known. */
export function thinkingLabel(ms: number | null): string {
	return ms && ms > 0 ? `已思考 ${fmtDur(ms)}` : "已思考";
}

export type ToolKind = "shell" | "read" | "edit" | "search" | "web" | "agent" | "todo" | "other";

const TOOL_VERBS: Record<string, [string, ToolKind]> = {
	bash: ["运行", "shell"],
	shell: ["运行", "shell"],
	eval: ["执行代码", "shell"],
	read: ["读取", "read"],
	write: ["写入", "edit"],
	edit: ["编辑", "edit"],
	ast_edit: ["结构化编辑", "edit"],
	notebook: ["编辑笔记本", "edit"],
	grep: ["搜索", "search"],
	find: ["查找", "search"],
	glob: ["查找文件", "search"],
	search: ["搜索", "search"],
	lsp: ["代码分析", "search"],
	web_search: ["搜索网页", "web"],
	fetch: ["打开网页", "web"],
	browser: ["浏览器", "web"],
	task: ["子代理", "agent"],
	todo_write: ["更新待办", "todo"],
	todo: ["更新待办", "todo"],
	ask: ["提问", "other"],
};

/** Readable row facts of a tool call: verb (Chinese when known, else the tool name), target, icon kind. */
export function toolLine(name: string, args: unknown): { verb: string; target: string; kind: ToolKind } {
	const hit = TOOL_VERBS[name.toLowerCase()];
	return { verb: hit ? hit[0] : name, target: argSummary(args), kind: hit ? hit[1] : "other" };
}

/** One-line argument summary of a tool call, for the collapsed card header. */
export function argSummary(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args.replace(/\s+/g, " ").slice(0, 120);
	const rec = args as Record<string, unknown>;
	for (const k of ["command", "path", "file_path", "pattern", "query", "url", "description", "prompt", "intent"]) {
		const v = rec[k];
		if (typeof v === "string") return v.replace(/\s+/g, " ").slice(0, 120);
	}
	try {
		return JSON.stringify(args).slice(0, 120);
	} catch {
		return "";
	}
}

export function prettyArgs(v: unknown): string {
	if (typeof v === "string") return v;
	try {
		return JSON.stringify(v, null, 2) ?? "";
	} catch {
		return String(v);
	}
}
