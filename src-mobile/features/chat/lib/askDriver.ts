/**
 * Maps omp's generic UI requests onto the `ask` tool (port of the desktop askDriver, pure).
 *
 * In `--mode rpc` omp drives each ask question through plain `select` / `editor` requests, one at a time. The
 * phone reads every question from the ask tool-call arguments, lets the user page through them locally
 * (上一题 keeps earlier choices) and, on 提交, replays the drafted answers as the RPC response sequence: each
 * request omp sends next is resolved from the stored drafts.
 */
import type { ToolItem } from "../../../core/types";

export const OTHER_OPTION = "Other (type your own)";
const RECOMMENDED_SUFFIX = " (Recommended)";
const DONE_SUFFIX = " Done selecting";

export interface AskOption {
	label: string;
	description?: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	options: AskOption[];
	multi: boolean;
	recommended?: number;
}

export interface AskSpec {
	toolCallId: string;
	questions: AskQuestion[];
}

export interface AskAnswer {
	/** Chosen option labels (undecorated). */
	selected: string[];
	/** Free text typed into the 「其他」 field; empty = none. */
	custom: string;
}

/** Per-question replay progress. */
export interface AskDriverState {
	answer: AskAnswer;
	/** Labels toggled on in omp's multi-select loop so far. */
	toggled: string[];
}

export interface AskMatch {
	requestId: string;
	method: "select" | "editor";
	qIndex: number;
	total: number;
	/** `(k selected)` prefix count (multi-select loop). */
	selectedCount: number;
	/** Undecorated label -> raw option string omp expects back. */
	optionByLabel: Record<string, string>;
	otherOption: string | null;
	doneOption: string | null;
}

export type AskResolution =
	| { kind: "auto"; value: string; toggled: string[] }
	| { kind: "present" }
	| { kind: "fallback" };

const asObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

export function parseAskArgs(toolCallId: string, args: unknown): AskSpec | null {
	let a = args;
	if (typeof a === "string") {
		try {
			a = JSON.parse(a);
		} catch {
			return null;
		}
	}
	const raw = asObj(a).questions;
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const questions: AskQuestion[] = [];
	for (const [i, q0] of raw.entries()) {
		const q = asObj(q0);
		if (typeof q.question !== "string" || !Array.isArray(q.options)) return null;
		const options: AskOption[] = [];
		for (const o0 of q.options) {
			const o = asObj(o0);
			if (typeof o.label !== "string") return null;
			options.push({ label: o.label, description: typeof o.description === "string" ? o.description : undefined });
		}
		questions.push({
			id: typeof q.id === "string" ? q.id : String(i),
			question: q.question,
			header: typeof q.header === "string" ? q.header : undefined,
			options,
			multi: q.multi === true,
			recommended: typeof q.recommended === "number" ? q.recommended : undefined,
		});
	}
	return { toolCallId, questions };
}

/** Ask tool calls still awaiting a result (status "running" = unresolved), latest first. */
export function findOpenAsks(tools: readonly ToolItem[]): AskSpec[] {
	const out: AskSpec[] = [];
	const seen = new Set<string>();
	for (let i = tools.length - 1; i >= 0; i--) {
		const t = tools[i];
		if (t.name !== "ask" || t.status !== "running" || seen.has(t.id)) continue;
		seen.add(t.id);
		const spec = parseAskArgs(t.id, t.args);
		if (spec) out.push(spec);
	}
	return out;
}

function parseTitle(title: string): { text: string; selectedCount: number; index: number | null; total: number | null } {
	let text = title;
	let selectedCount = 0;
	const pre = /^\((\d+) selected\) /.exec(text);
	if (pre) {
		selectedCount = Number(pre[1]);
		text = text.slice(pre[0].length);
	}
	let index: number | null = null;
	let total: number | null = null;
	const suf = / \((\d+)\/(\d+)\)$/.exec(text);
	if (suf) {
		index = Number(suf[1]);
		total = Number(suf[2]);
		text = text.slice(0, suf.index);
	}
	return { text, selectedCount, index, total };
}

const stripOption = (opt: string): string => (opt.endsWith(RECOMMENDED_SUFFIX) ? opt.slice(0, -RECOMMENDED_SUFFIX.length) : opt);

/** Recognise a raw pending request as a step of `spec`; null = not ours. */
export function matchRequest(spec: AskSpec, request: unknown): AskMatch | null {
	const r = asObj(request);
	const method = r.method;
	if (method !== "select" && method !== "editor") return null;
	if (typeof r.id !== "string" || typeof r.title !== "string") return null;
	const t = parseTitle(r.title);
	const n = spec.questions.length;
	let qIndex: number;
	if (t.index !== null && t.total !== null) {
		// Keep the suffix only if it really is omp's progress marker.
		if (t.total !== n || t.index < 1 || t.index > n) {
			return n === 1 && spec.questions[0].question === r.title.replace(/^\(\d+ selected\) /, "")
				? matchAt(spec, r, 0, 1, t.selectedCount)
				: null;
		}
		qIndex = t.index - 1;
	} else {
		if (n !== 1) return null;
		qIndex = 0;
	}
	const q = spec.questions[qIndex];
	if (q.question !== t.text) return null;
	if (t.selectedCount > 0 && !q.multi) return null;
	return matchAt(spec, r, qIndex, n, t.selectedCount);
}

function matchAt(spec: AskSpec, r: Record<string, unknown>, qIndex: number, total: number, selectedCount: number): AskMatch | null {
	const q = spec.questions[qIndex];
	const base = { requestId: r.id as string, qIndex, total, selectedCount };
	if (r.method === "editor") return { ...base, method: "editor", optionByLabel: {}, otherOption: null, doneOption: null };
	if (!Array.isArray(r.options) || !r.options.every((o) => typeof o === "string")) return null;
	const optionByLabel: Record<string, string> = {};
	let otherOption: string | null = null;
	let doneOption: string | null = null;
	for (const o of r.options as string[]) {
		if (o === OTHER_OPTION) otherOption = o;
		else if (q.multi && o.endsWith(DONE_SUFFIX)) doneOption = o;
		else optionByLabel[stripOption(o)] = o;
	}
	const labels = q.options.map((o) => o.label);
	if (Object.keys(optionByLabel).length !== labels.length || !labels.every((l) => l in optionByLabel)) return null;
	return { ...base, method: "select", optionByLabel, otherOption, doneOption };
}

/** Text sent to an open editor, including radio edits made after entering Other. */
export function editorText(q: AskQuestion, answer: AskAnswer): string {
	const custom = answer.custom.trim();
	if (!q.multi) return custom || (answer.selected.length === 1 ? answer.selected[0] : "");
	// omp's result keeps only customInput once Other is used, so the editor text must carry the labels.
	const sel = `Selected: ${answer.selected.length ? answer.selected.join(", ") : "none"}`;
	return custom ? `${sel}; note: ${custom}` : sel;
}

/** Multi-select may be submitted empty ("Selected: none"). */
export function isAnswerSubmittable(q: AskQuestion, answer: AskAnswer): boolean {
	return q.multi || answer.custom.trim() !== "" || answer.selected.length === 1;
}

/** Decide what to send for a matched request given the stored draft. */
export function resolveRequest(q: AskQuestion, m: AskMatch, state: AskDriverState | undefined): AskResolution {
	if (!state) return m.method === "select" && m.selectedCount === 0 ? { kind: "present" } : { kind: "fallback" };
	const { answer, toggled } = state;
	const custom = answer.custom.trim();
	if (m.method === "editor") {
		const text = editorText(q, answer);
		return text ? { kind: "auto", value: text, toggled } : { kind: "fallback" };
	}
	if (!q.multi) {
		if (custom) return m.otherOption ? { kind: "auto", value: m.otherOption, toggled } : { kind: "fallback" };
		const raw = m.optionByLabel[answer.selected[0] ?? ""];
		return raw ? { kind: "auto", value: raw, toggled } : { kind: "fallback" };
	}
	// Multi-select loop: our toggle bookkeeping must agree with omp's count.
	if (m.selectedCount !== toggled.length) return { kind: "fallback" };
	const want = new Set(answer.selected);
	const flip = answer.selected.find((l) => !toggled.includes(l)) ?? toggled.find((l) => !want.has(l));
	if (flip !== undefined) {
		const raw = m.optionByLabel[flip];
		if (!raw) return { kind: "fallback" };
		const next = toggled.includes(flip) ? toggled.filter((l) => l !== flip) : [...toggled, flip];
		return { kind: "auto", value: raw, toggled: next };
	}
	if (!custom && m.doneOption && toggled.length > 0) return { kind: "auto", value: m.doneOption, toggled };
	return m.otherOption ? { kind: "auto", value: m.otherOption, toggled } : { kind: "fallback" };
}

/** Whether `value` is the last reply of question `m` (no follow-up request for it). */
export function isFinalReply(q: AskQuestion, m: AskMatch, value: string): boolean {
	return m.method === "editor" || (value !== OTHER_OPTION && (!q.multi || value === m.doneOption));
}
