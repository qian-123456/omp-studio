/** [B] Command chip model. Two flavours:
 *  - legacy (no `offset`): atomic `/name` pinned to the input start; the
 *    textarea holds only the arguments.
 *  - inline (skills, `offset` set): the literal `/skill:name` stays in the
 *    draft at `offset` (so caret/selection/privacy ranges stay trivially
 *    aligned) and the mirror layer paints it as an icon + label token.
 * On send both serialize to the exact `/name args` string omp expects (omp
 * only recognises a command at the very start), so transport/history/queue
 * behavior is unchanged. */

import { Sparkles } from "lucide-react";
import { DYNAMIC_COMMAND_ICON, findSlashCommand } from "./registry";
import type { SlashCommandDef } from "./types";

export interface CommandChip {
	/** Primary command name, without the leading slash. */
	name: string;
	/** Display title captured at menu pick time (dynamic omp commands may
	 * have none — the name is shown then). */
	title: string;
	/** Ghost argument hint shown inline after the chip while args are empty. */
	argHint?: string;
	/** Inline chips: index of the literal `/name` inside the draft text. */
	offset?: number;
	/** Subcommand merged into the chip (`/mcp enable`); legacy chips only. */
	sub?: string;
}

const SKILL_PREFIX = "skill:";

/** Invisible separator (U+2063) written into the wire text where a
 * mid-text inline chip sat. omp only expands a command at the very start, so
 * the token is lifted to the front; this marker records the original spot so
 * the bubble (live and from the persisted transcript) can put the chip back. */
export const CHIP_POSITION_MARK = "\u2063";

export function isSkillChip(chip: CommandChip): boolean {
	return chip.name.startsWith(SKILL_PREFIX) && chip.name.length > SKILL_PREFIX.length;
}

export interface ChipRange {
	start: number;
	end: number;
}

/** The literal draft text an inline chip occupies. */
export function chipLiteral(chip: CommandChip): string {
	return `/${chip.name}`;
}

/** Token boundary: the literal must be followed by whitespace or the end. */
function isBounded(text: string, end: number): boolean {
	return end >= text.length || /\s/.test(text[end] ?? "");
}

/** Range of an inline chip's literal at its recorded offset, or null when
 * the chip is legacy or the draft no longer holds an intact literal there. */
export function inlineChipRange(
	chip: CommandChip | null | undefined,
	text: string,
): ChipRange | null {
	if (!chip || chip.offset === undefined) return null;
	const lit = chipLiteral(chip);
	const start = chip.offset;
	const end = start + lit.length;
	if (!text.startsWith(lit, start) || !isBounded(text, end)) return null;
	return { start, end };
}

/** Occurrence of the literal nearest to `near` (used on masked text whose
 * offsets drifted), or null. */
export function findChipRange(
	chip: CommandChip,
	text: string,
	near: number,
): ChipRange | null {
	const lit = chipLiteral(chip);
	let best: ChipRange | null = null;
	let bestDist = Infinity;
	for (let i = text.indexOf(lit); i !== -1; i = text.indexOf(lit, i + 1)) {
		const end = i + lit.length;
		if (!isBounded(text, end)) continue;
		const d = Math.abs(i - near);
		if (d < bestDist) {
			best = { start: i, end };
			bestDist = d;
		}
	}
	return best;
}

/** Track an inline chip's offset across a text edit. The edit is the diff
 * region between `prev` and `next` (common prefix/suffix stripped):
 * - entirely before (or inserted exactly at) the literal → shift by the
 *   length delta;
 * - entirely after the literal → unchanged;
 * - overlapping the literal → offset collapses to the edit start (the caller
 *   then finds the literal broken and drops the chip). */
export function shiftChipOffset(
	prev: string,
	next: string,
	offset: number,
	literalLength: number,
): number {
	if (prev === next) return offset;
	const max = Math.min(prev.length, next.length);
	let p = 0;
	while (p < max && prev[p] === next[p]) p++;
	let s = 0;
	while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
	const prevEnd = prev.length - s;
	if (p >= offset + literalLength) return offset;
	if (prevEnd <= offset) return offset + (next.length - prev.length);
	return p;
}

/** Insert the literal of `chip` at `at` in `text` (replacing `[at, replaceEnd)`),
 * followed by one separating space unless whitespace already follows.
 * Returns the new text, the chip with its offset and the caret position. */
export function insertChipAt(
	chip: CommandChip,
	text: string,
	at: number,
	replaceEnd: number = at,
): { text: string; chip: CommandChip; caret: number } {
	const lit = chipLiteral(chip);
	const after = text.slice(replaceEnd);
	const gap = /^\s/.test(after) ? "" : " ";
	const caret = at + lit.length + 1;
	return {
		text: `${text.slice(0, at)}${lit}${gap}${after}`,
		chip: { ...chip, offset: at },
		caret,
	};
}

/** `chip + draft` → the literal text omp expects (contract). Inline chips
 * lift their token to the front only here; `locate: "fuzzy"` tolerates
 * shifted offsets (masked text). */
export function serializeChip(
	chip: CommandChip | null | undefined,
	argsText: string,
	locate: "exact" | "fuzzy" = "exact",
): string {
	if (!chip || !chip.name) return argsText;
	if (chip.offset !== undefined) {
		const range =
			inlineChipRange(chip, argsText) ??
			(locate === "fuzzy" ? findChipRange(chip, argsText, chip.offset) : null);
		if (range) {
			const before = argsText.slice(0, range.start).trim();
			const after = argsText.slice(range.end).trim();
			if (before) {
				const nl = /\n\s*$/.test(argsText.slice(0, range.start));
				const sep = nl ? "\n" : " ";
				return `/${chip.name} ${before}${sep}${CHIP_POSITION_MARK}${after ? `${sep}${after}` : ""}`;
			}
			return after ? `/${chip.name} ${after}` : `/${chip.name}`;
		}
	}
	const args = argsText.trim();
	const head = chip.sub ? `/${chip.name} ${chip.sub}` : `/${chip.name}`;
	return args ? `${head} ${args}` : head;
}

export function chipIcon(
	chip: CommandChip,
): SlashCommandDef["icon"] {
	if (isSkillChip(chip)) return Sparkles;
	return findSlashCommand(chip.name)?.icon ?? DYNAMIC_COMMAND_ICON;
}

export function chipLabel(chip: CommandChip): string {
	if (isSkillChip(chip)) return chip.name.slice(SKILL_PREFIX.length);
	const base = findSlashCommand(chip.name)?.title || chip.title || chip.name;
	return chip.sub ? `${base} ${chip.sub}` : base;
}


// ---------------------------------------------------------------------------
// Persistence: drafts survive session switches (stores/composer.ts), so the
// chip must too — a dropped chip would silently change what gets sent.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ompws:command-chips";

type ChipMap = Record<string, CommandChip>;

function readAll(): ChipMap {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		const out: ChipMap = {};
		for (const [sid, v] of Object.entries(raw as Record<string, unknown>)) {
			if (!v || typeof v !== "object") continue;
			const name = (v as Record<string, unknown>).name;
			const title = (v as Record<string, unknown>).title;
			if (typeof name === "string" && /^[^\s/]+$/.test(name)) {
				const argHint = (v as Record<string, unknown>).argHint;
				const offset = (v as Record<string, unknown>).offset;
				const sub = (v as Record<string, unknown>).sub;
				out[sid] = {
					name,
					title: typeof title === "string" ? title : name,
					...(typeof argHint === "string" ? { argHint } : {}),
					...(typeof sub === "string" && /^[^\s/]+$/.test(sub) ? { sub } : {}),
					...(typeof offset === "number" && Number.isInteger(offset) && offset >= 0
						? { offset }
						: {}),
				};
			}
		}
		return out;
	} catch {
		return {};
	}
}

export function loadChip(sessionId: string): CommandChip | null {
	return readAll()[sessionId] ?? null;
}

export function saveChip(sessionId: string, chip: CommandChip | null): void {
	try {
		const map = readAll();
		if (chip) map[sessionId] = {
				name: chip.name,
				title: chip.title,
				...(chip.argHint ? { argHint: chip.argHint } : {}),
				...(chip.sub ? { sub: chip.sub } : {}),
				...(chip.offset !== undefined ? { offset: chip.offset } : {}),
			};
		else delete map[sessionId];
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* storage unavailable — chip simply becomes session-scoped */
	}
}

// ---------------------------------------------------------------------------
// Sent-message display: a leading `/skill:x` (or known registry command) in a
// user bubble renders as the same token the composer shows.
// ---------------------------------------------------------------------------

export function parseLeadingCommand(
	text: string,
): { chip: CommandChip; rest: string; tail?: string } | null {
	const m = /^\/([^\s/]+)(?=\s|$)/.exec(text);
	if (!m) return null;
	const name = m[1] as string;
	const chip: CommandChip = { name, title: name };
	const def = findSlashCommand(name);
	if (!isSkillChip(chip) && !def) return null;
	let rest = text.slice(m[0].length).replace(/^[ \t]+/, "");
	const sm = /^([^\s/]+)(?=\s|$)/.exec(rest);
	if (sm && def?.subcommands?.some((s) => s.name === sm[1])) {
		chip.sub = sm[1];
		rest = rest.slice(sm[0].length).replace(/^[ \t]+/, "");
	}
	const at = rest.indexOf(CHIP_POSITION_MARK);
	if (at !== -1) {
		return {
			chip,
			rest: rest.slice(0, at).trimEnd(),
			tail: rest.slice(at + CHIP_POSITION_MARK.length).replace(/^[ \t]*\n?[ \t]*/, ""),
		};
	}
	return { chip, rest };
}
