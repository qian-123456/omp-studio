/** Slash commands: per-session in-memory cache, local filtering, grouping. Filtering never touches the network. */
import { api } from "../../../core/api";

export interface SlashCmd {
	name: string;
	title?: string;
	description?: string;
	argHint?: string | null;
	group?: string;
	kind?: "native" | "forward" | "custom";
	needsArg?: boolean;
}

export interface SlashGroup {
	group: string;
	items: SlashCmd[];
}

/** `/foo` (no whitespace yet) → `"foo"`; anything else → null. Cheap: bails on the first character. */
export function detectSlashQuery(value: string): string | null {
	if (value.charCodeAt(0) !== 47) return null;
	if (/\s/.test(value)) return null;
	return value.slice(1);
}

function score(c: SlashCmd, q: string): number {
	const name = c.name.toLowerCase();
	if (name === q) return 0;
	if (name.startsWith(q)) return 1;
	if (name.includes(q)) return 2;
	if ((c.title || "").toLowerCase().includes(q)) return 3;
	if ((c.description || "").toLowerCase().includes(q)) return 4;
	return -1;
}

/** Local filter: prefix matches first, then name, title, description matches; stable inside a rank. */
export function filterCommands(cmds: readonly SlashCmd[], query: string): SlashCmd[] {
	const q = query.trim().toLowerCase();
	if (!q) return cmds.slice();
	const ranked: { c: SlashCmd; s: number; i: number }[] = [];
	cmds.forEach((c, i) => {
		const s = score(c, q);
		if (s >= 0) ranked.push({ c, s, i });
	});
	ranked.sort((a, b) => a.s - b.s || a.i - b.i);
	return ranked.map((r) => r.c);
}

export function groupCommands(cmds: readonly SlashCmd[]): SlashGroup[] {
	const groups = new Map<string, SlashCmd[]>();
	for (const c of cmds) {
		const g = c.group || "其他";
		const list = groups.get(g);
		if (list) list.push(c);
		else groups.set(g, [c]);
	}
	return Array.from(groups, ([group, items]) => ({ group, items }));
}

/** `/name rest` → `{name, args}`; null when the text is not a slash command. */
export function parseSlashInput(text: string): { name: string; args: string } | null {
	const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
	return m ? { name: m[1], args: (m[2] || "").trim() } : null;
}

/** What tapping a command in the list does: run it now, or put `/name ` into the input. */
export function commandAction(c: SlashCmd): "run" | "fill" {
	return c.needsArg ? "fill" : "run";
}

export const commandInput = (c: SlashCmd): string => `/${c.name} `;

/* ---------------------------------------------------------------- cache */

const cache = new Map<string, SlashCmd[]>();
const inflight = new Map<string, Promise<SlashCmd[]>>();

export function cachedCommands(sessionId: string): SlashCmd[] | null {
	return cache.get(sessionId) ?? null;
}

export function clearSlashCache(sessionId?: string): void {
	if (sessionId) {
		cache.delete(sessionId);
		inflight.delete(sessionId);
	} else {
		cache.clear();
		inflight.clear();
	}
}

type Fetcher = (sessionId: string) => Promise<SlashCmd[]>;
const defaultFetcher: Fetcher = (id) => api<SlashCmd[]>("GET", `/sessions/${id}/slash-commands`);

/** Fetch once per session (concurrent callers share the request); resolves from cache when present. */
export function loadSlashCommands(sessionId: string, fetcher: Fetcher = defaultFetcher): Promise<SlashCmd[]> {
	const hit = cache.get(sessionId);
	if (hit) return Promise.resolve(hit);
	const pending = inflight.get(sessionId);
	if (pending) return pending;
	const p = fetcher(sessionId)
		.then((list) => {
			const arr = Array.isArray(list) ? list : [];
			cache.set(sessionId, arr);
			return arr;
		})
		.finally(() => {
			inflight.delete(sessionId);
		});
	inflight.set(sessionId, p);
	return p;
}
