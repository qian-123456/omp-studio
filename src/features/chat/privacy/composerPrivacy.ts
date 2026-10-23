/** [P] Pure composer privacy logic: draft ranges, highlight classification and send-time masking. */

import type { PrivacyMarkScope, SecretEntry } from "../../../lib/contracts";
import { findValueMatches } from "../../../lib/privacy";

export interface TextRange {
	start: number;
	end: number;
}

/** A range bound to a secret entry (the entry is a snapshot; the store copy wins when present). */
export interface EntryRange extends TextRange {
	entry: SecretEntry;
}

/**
 * Per-session draft privacy state. `text` is the draft the ranges refer to;
 * ranges are rebased whenever the draft changes.
 */
export interface PrivacyDraft {
	text: string;
	/** Explicitly marked ranges ("标记为隐私"), always replaced unless undone. */
	marked: EntryRange[];
	/** Occurrences the user excluded for this send (撤销). */
	undone: EntryRange[];
	/** Risky suggestions the user chose to include. */
	accepted: EntryRange[];
	/** Scope chosen in the mark popover, by entry id; used when the entry is linked at send time. */
	scopes: Record<string, PrivacyMarkScope>;
}

export const EMPTY_DRAFT: PrivacyDraft = { text: "", marked: [], undone: [], accepted: [], scopes: {} };

/** A value already in the session transcript was already sent upstream: the user must choose a scope. */
export function needsScopeChoice(sessionOccurrences: number): boolean {
	return sessionOccurrences > 0;
}

/** Popover default: protect only later content when the value was already sent; otherwise nothing to protect retroactively. */
export function defaultMarkScope(sessionOccurrences: number): PrivacyMarkScope {
	return needsScopeChoice(sessionOccurrences) ? "future" : "all";
}

/**
 * Scope for linking an entry to the session at send time: the scope remembered
 * in the draft wins, otherwise `future` when the value already appears in the
 * transcript, else `all`.
 */
export function resolveLinkScope(
	remembered: PrivacyMarkScope | undefined,
	sessionOccurrences: number,
): PrivacyMarkScope {
	return remembered ?? defaultMarkScope(sessionOccurrences);
}

/**
 * - `marked`: explicit mark → replaced
 * - `auto`: tracked safe value of this session / library → replaced
 * - `accepted`: risky suggestion the user included → replaced
 * - `suggestion`: risky tracked value → not replaced unless clicked
 * - `undone`: excluded for this send → not replaced
 */
export type HighlightKind = "marked" | "auto" | "accepted" | "suggestion" | "undone";

export interface Highlight extends EntryRange {
	kind: HighlightKind;
}

export function isReplaced(kind: HighlightKind): boolean {
	return kind === "marked" || kind === "auto" || kind === "accepted";
}

function overlaps(a: TextRange, b: TextRange): boolean {
	return a.start < b.end && b.start < a.end;
}

function sameRange(a: EntryRange, b: EntryRange): boolean {
	return a.start === b.start && a.end === b.end && a.entry.id === b.entry.id;
}

/**
 * Rebase ranges from `prev` to `next` using the single edited region
 * (common prefix/suffix). Ranges touching the edit are dropped.
 */
export function rebaseRanges<T extends TextRange>(ranges: T[], prev: string, next: string): T[] {
	if (prev === next || ranges.length === 0) return ranges;
	const max = Math.min(prev.length, next.length);
	let p = 0;
	while (p < max && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
	let s = 0;
	while (
		s < max - p &&
		prev.charCodeAt(prev.length - 1 - s) === next.charCodeAt(next.length - 1 - s)
	)
		s++;
	const prevEditEnd = prev.length - s;
	const delta = next.length - prev.length;
	const out: T[] = [];
	for (const r of ranges) {
		if (r.end <= p) out.push(r);
		else if (r.start >= prevEditEnd) out.push({ ...r, start: r.start + delta, end: r.end + delta });
	}
	return out;
}

export function rebaseDraft(draft: PrivacyDraft, next: string): PrivacyDraft {
	if (draft.text === next) return draft;
	return {
		text: next,
		marked: rebaseRanges(draft.marked, draft.text, next),
		undone: rebaseRanges(draft.undone, draft.text, next),
		accepted: rebaseRanges(draft.accepted, draft.text, next),
		scopes: draft.scopes,
	};
}

export interface HighlightInput {
	text: string;
	draft: PrivacyDraft;
	/** All known entries (store). */
	entries: SecretEntry[];
	/** Entry ids linked to the current session. */
	sessionEntryIds: ReadonlySet<string>;
}

/** Classify every privacy-relevant range of the draft, sorted by start. */
export function computeHighlights({ text, draft, entries, sessionEntryIds }: HighlightInput): Highlight[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const has = (list: EntryRange[], r: EntryRange) => list.some((x) => sameRange(x, r));
	const out: Highlight[] = [];
	for (const m of draft.marked) {
		const entry = byId.get(m.entry.id) ?? m.entry;
		if (text.slice(m.start, m.end) !== entry.value) continue;
		if (out.some((h) => overlaps(h, m))) continue;
		const r = { start: m.start, end: m.end, entry };
		out.push({ ...r, kind: has(draft.undone, r) ? "undone" : "marked" });
	}
	const candidates = entries.filter((e) => e.track && (e.inLibrary || sessionEntryIds.has(e.id)));
	for (const m of findValueMatches(text, candidates)) {
		if (out.some((h) => overlaps(h, m))) continue;
		const r = { start: m.start, end: m.end, entry: m.entry };
		let kind: HighlightKind;
		if (has(draft.undone, r)) kind = "undone";
		else if (m.entry.risk === "risky") kind = has(draft.accepted, r) ? "accepted" : "suggestion";
		else kind = "auto";
		out.push({ ...r, kind });
	}
	return out.sort((a, b) => a.start - b.start);
}

/** Replace every replaced-kind highlight with its entry's current placeholder. */
export function maskText(text: string, highlights: Highlight[]): string {
	let out = text;
	const replaced = highlights.filter((h) => isReplaced(h.kind)).sort((a, b) => b.start - a.start);
	for (const h of replaced) out = out.slice(0, h.start) + h.entry.placeholder + out.slice(h.end);
	return out;
}

/** Entries actually replaced in a send (deduplicated). */
export function replacedEntries(highlights: Highlight[]): SecretEntry[] {
	const seen = new Map<string, SecretEntry>();
	for (const h of highlights) if (isReplaced(h.kind)) seen.set(h.entry.id, h.entry);
	return [...seen.values()];
}

/** State transition for clicking a highlight's action (撤销 / 恢复 / 替换此处). */
export function toggleHighlight(draft: PrivacyDraft, h: Highlight): PrivacyDraft {
	const r: EntryRange = { start: h.start, end: h.end, entry: h.entry };
	switch (h.kind) {
		case "marked":
		case "auto":
			return { ...draft, undone: [...draft.undone, r] };
		case "undone":
			return { ...draft, undone: draft.undone.filter((x) => !sameRange(x, r)) };
		case "suggestion":
			return { ...draft, accepted: [...draft.accepted, r] };
		case "accepted":
			return { ...draft, accepted: draft.accepted.filter((x) => !sameRange(x, r)) };
	}
}

/** Add an explicit mark, replacing overlapping marks and clearing exclusions on that range. */
export function addMark(draft: PrivacyDraft, r: EntryRange, scope?: PrivacyMarkScope): PrivacyDraft {
	return {
		...draft,
		scopes: scope ? { ...draft.scopes, [r.entry.id]: scope } : draft.scopes,
		marked: [...draft.marked.filter((x) => !overlaps(x, r)), r],
		undone: draft.undone.filter((x) => !overlaps(x, r)),
		accepted: draft.accepted.filter((x) => !overlaps(x, r)),
	};
}

/** Entries of the session that still need the library prompt. */
export function libraryPromptCandidates(
	entries: SecretEntry[],
	sessionEntryIds: ReadonlySet<string>,
): SecretEntry[] {
	return entries.filter((e) => sessionEntryIds.has(e.id) && !e.inLibrary && !e.libraryPrompted);
}
