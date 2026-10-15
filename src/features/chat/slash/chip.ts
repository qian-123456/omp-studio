/** [B] Command chip model: an atomic `/name` token pinned to the start of
 * the composer. The textarea holds only the argument text; on send the chip
 * serializes back to the exact `/name args` string a user would have typed,
 * so transport/history/queue behavior is unchanged. */

import { DYNAMIC_COMMAND_ICON, findSlashCommand } from "./registry";
import type { SlashCommandDef } from "./types";

export interface CommandChip {
	/** Primary command name, without the leading slash. */
	name: string;
	/** Display title captured at menu pick time (dynamic omp commands may
	 * have none — the name is shown then). */
	title: string;
}

/** `chip + args` → the literal text omp expects (contract). */
export function serializeChip(
	chip: CommandChip | null | undefined,
	argsText: string,
): string {
	if (!chip || !chip.name) return argsText;
	const args = argsText.trim();
	return args ? `/${chip.name} ${args}` : `/${chip.name}`;
}

export function chipIcon(
	chip: CommandChip,
): SlashCommandDef["icon"] {
	return findSlashCommand(chip.name)?.icon ?? DYNAMIC_COMMAND_ICON;
}

export function chipLabel(chip: CommandChip): string {
	return findSlashCommand(chip.name)?.title || chip.title || chip.name;
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
				out[sid] = { name, title: typeof title === "string" ? title : name };
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
		if (chip) map[sessionId] = { name: chip.name, title: chip.title };
		else delete map[sessionId];
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* storage unavailable — chip simply becomes session-scoped */
	}
}
