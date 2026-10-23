/** [B] Generic argument-completion rows: a provider's candidates → popup items.
 * Provider table lives in argProviders.ts. */

import type { SlashMenuItem } from "./menu";
import type { SlashCommandDef, SlashGroup } from "./types";

/** One completable argument value (a server, plugin, …). */
export interface ArgCandidate {
	name: string;
	/** Second-line description shown in the popup. */
	description: string;
	/** Drives ordering: `enable` lists disabled first, other subs enabled first. */
	enabled?: boolean;
}

export interface ArgProvider {
	/** Popup section label. */
	groupLabel: SlashGroup;
	icon: SlashCommandDef["icon"];
	/** Fetch current candidates (local data source). */
	load(cwd?: string | null): Promise<ArgCandidate[]>;
}

/** Rows for `candidates` matching `query` (prefix matches first, then
 * substring; empty query = all). `enable` lists disabled candidates first,
 * every other subcommand lists enabled ones first; order is stable otherwise. */
export function buildArgItems(
	provider: Pick<ArgProvider, "groupLabel" | "icon">,
	candidates: readonly ArgCandidate[],
	sub: string,
	query: string,
): SlashMenuItem[] {
	const q = query.toLowerCase();
	const wantEnabledFirst = sub !== "enable";
	const rank = (c: ArgCandidate): number => (c.name.toLowerCase().startsWith(q) ? 0 : 1);
	return candidates
		.filter((c) => c.name.toLowerCase().includes(q))
		.map((c, i) => ({ c, i }))
		.sort((a, b) => {
			const m = rank(a.c) - rank(b.c);
			if (m !== 0) return m;
			const pa = a.c.enabled === undefined || a.c.enabled === wantEnabledFirst ? 0 : 1;
			const pb = b.c.enabled === undefined || b.c.enabled === wantEnabledFirst ? 0 : 1;
			return pa - pb || a.i - b.i;
		})
		.map(({ c }) => ({
			name: c.name,
			title: "",
			description: c.description,
			icon: provider.icon,
			group: provider.groupLabel,
			registry: false,
			plain: true,
		}));
}

/** Replace the draft's first word with `name`; keeps the rest, and appends a
 * single space (caret after it) when nothing follows. */
export function applyArgName(text: string, name: string): { text: string; caret: number } {
	const m = /^\S*/.exec(text);
	const rest = text.slice(m?.[0].length ?? 0);
	if (rest === "") return { text: `${name} `, caret: name.length + 1 };
	return { text: name + rest, caret: name.length };
}
