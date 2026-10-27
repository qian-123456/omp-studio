/**
 * Pure parsing/answering logic for omp's pending extension UI requests
 * (rpc/process.rs: select | confirm | input | editor).
 *
 * `ask` questions arrive as a loop of `select` requests: the title carries
 * "(N selected) " and " (i/n)", the options carry " (Recommended)" /
 * " Done selecting" decorations, and the free-text row is the literal
 * "Other (type your own)". Sending one raw option flips ONE choice; omp then
 * re-asks with a refreshed title; the reply carrying the Done row ends it.
 */
import type { PendingEntry, PendingForm, PendingOption, PendingRequest } from "./types";

export const PENDING_OTHER = "Other (type your own)";
const RECOMMENDED_SUFFIX = " (Recommended)";
const DONE_SUFFIX = " Done selecting";

/** Parse one pending-ui entry (or a bare request) into render facts. */
export function pendingForm(entry: PendingEntry | PendingRequest | null | undefined, fallbackSessionId?: string | null): PendingForm {
	const wrapped = entry as PendingEntry | null | undefined;
	const req: PendingRequest = (wrapped && wrapped.request) || (entry as PendingRequest) || {};
	const method = typeof req.method === "string" ? req.method : "";
	let title = typeof req.title === "string" ? req.title : "";
	let selectedCount = 0;
	const pre = /^\((\d+) selected\) /.exec(title);
	if (pre) {
		selectedCount = Number(pre[1]);
		title = title.slice(pre[0].length);
	}
	let index: number | null = null;
	let total: number | null = null;
	const suf = / \((\d+)\/(\d+)\)$/.exec(title);
	if (suf) {
		index = Number(suf[1]);
		total = Number(suf[2]);
		title = title.slice(0, suf.index);
	}
	const raw = Array.isArray(req.options) ? req.options.filter((o): o is string => typeof o === "string") : [];
	const details = Array.isArray(req.optionDetails) ? req.optionDetails : [];
	const options: PendingOption[] = raw.map((o, i) => {
		const isOther = o === PENDING_OTHER;
		const isDone = o.endsWith(DONE_SUFFIX);
		const recommended = !isDone && o.endsWith(RECOMMENDED_SUFFIX);
		const label = isDone
			? o.slice(0, -DONE_SUFFIX.length)
			: recommended
				? o.slice(0, -RECOMMENDED_SUFFIX.length)
				: o;
		const detail = details[i];
		return {
			raw: o,
			label,
			recommended,
			isDone,
			isOther,
			description: detail && typeof detail.description === "string" ? detail.description : "",
		};
	});
	const message = typeof req.message === "string" ? req.message : "";
	return {
		id: typeof req.id === "string" ? req.id : "",
		method,
		title,
		message,
		placeholder: typeof req.placeholder === "string" ? req.placeholder : "",
		// Same rule as desktop PendingUiCard: an explicit flag wins, otherwise a
		// "required"/"必填" hint in the copy makes an empty submit invalid.
		required:
			req.required === true ||
			(req.required !== false && req.allowEmpty !== true && /required|必填/i.test(`${title} ${message}`)),
		defaultValue:
			typeof req.default === "string" ? req.default : typeof req.defaultValue === "string" ? req.defaultValue : "",
		options,
		selectedCount,
		index,
		total,
		multiple: selectedCount > 0 || options.some((o) => o.isDone),
		text: method === "input" || method === "editor",
		sessionId: (wrapped && wrapped.sessionId) || fallbackSessionId || null,
	};
}

export interface PendingAnswer {
	value?: string;
	text?: string;
	confirmed?: boolean;
	cancelled?: boolean;
	always?: boolean;
	persist?: boolean;
}

export interface UiResponseBody {
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
	always?: boolean;
	persist?: boolean;
}

/**
 * Build the `{response}` payload for `POST /sessions/{id}/ui-respond`. Throws a
 * user-facing Error on invalid answers (missing id, empty required text).
 */
export function buildPendingResponse(entry: PendingEntry | PendingRequest, answer: PendingAnswer): UiResponseBody {
	const form = pendingForm(entry);
	if (!form.id) throw new Error("待处理请求缺少 id");
	const value = answer.value !== undefined ? answer.value : answer.text;
	if (form.text && form.required && value !== undefined && !String(value).trim()) throw new Error("该问题必填");
	if (value === undefined && typeof answer.confirmed !== "boolean" && answer.cancelled !== true) {
		throw new Error("回答需要 value、text、confirmed 或 cancelled");
	}
	// Desktop falls back to the request's default when the box is empty.
	const finalValue = value === undefined ? undefined : value === "" && form.defaultValue ? form.defaultValue : value;
	const body: UiResponseBody = { id: form.id };
	if (finalValue !== undefined) body.value = finalValue;
	if (typeof answer.confirmed === "boolean") body.confirmed = answer.confirmed;
	if (answer.cancelled === true) body.cancelled = true;
	if (answer.always === true) body.always = true;
	if (answer.persist === true) body.persist = true;
	return body;
}

/**
 * Next raw option to send so the server-side selection becomes `selectedLabels`.
 * `toggled` = labels already flipped by earlier loop replies. Returns null when
 * nothing is left to flip.
 */
export function nextMultiChoice(
	entry: PendingEntry | PendingRequest,
	selectedLabels: readonly string[],
	toggled: readonly string[],
): { value: string; toggled: string[] } | null {
	const form = pendingForm(entry);
	const byLabel = new Map<string, string>();
	for (const opt of form.options) if (!opt.isDone && !opt.isOther) byLabel.set(opt.label, opt.raw);
	const add = selectedLabels.find((l) => !toggled.includes(l));
	const drop = toggled.find((l) => !selectedLabels.includes(l));
	const flip = add !== undefined ? add : drop;
	if (flip === undefined) return null;
	const raw = byLabel.get(flip);
	if (!raw) return null;
	return { value: raw, toggled: add !== undefined ? [...toggled, flip] : toggled.filter((l) => l !== flip) };
}

/** Raw " Done selecting" row of an open multi-select question, or null. */
export function doneOption(entry: PendingEntry | PendingRequest): string | null {
	return pendingForm(entry).options.find((o) => o.isDone)?.raw ?? null;
}

/** Raw "Other (type your own)" row, or null. */
export function otherOption(entry: PendingEntry | PendingRequest): string | null {
	return pendingForm(entry).options.find((o) => o.isOther)?.raw ?? null;
}

/** True for tool-approval / yes-no requests that batch-approve may answer (never ask-user questions). */
export function isApprovalRequest(entry: PendingEntry | PendingRequest): boolean {
	const form = pendingForm(entry);
	return form.method === "confirm";
}
