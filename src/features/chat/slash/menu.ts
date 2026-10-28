/** [B] Slash menu model: merge registry + omp dynamic commands into
 * grouped, fuzzy-filtered menu items. Pure functions (testable). */

import {
	BookMarked,
	FileText,
	Puzzle,
	Terminal,
} from "lucide-react";
import type { SlashCommand } from "../../../stores/live";
import { tNow } from "../../../stores/language";

import { findSlashCommand, SLASH_COMMANDS } from "./registry";
import type { SlashCommandDef, SlashGroup, SlashSubcommand } from "./types";
export interface SlashMenuItem {
	/** Slash name inserted/executed. */
	name: string;
	title: string;
	description: string;
	icon: SlashCommandDef["icon"];
	group: SlashGroup;
	argHint?: string;
	settingsTarget?: SlashCommandDef["settingsTarget"];
	/** True for registry commands (native execution path). */
	registry: boolean;
	/** Parent command name when this item is a subcommand entry. */
	subOf?: string;
	/** Parent's display title (chip label when a subcommand row is picked). */
	parentTitle?: string;
	/** Subcommand row listed under its parent in the top-level menu (indented). */
	nested?: boolean;
	/** Second-level entry that runs the parent command itself (no subcommand). */
	bare?: boolean;
	/** Present when the command takes subcommands. */
	subcommands?: SlashSubcommand[];
	/** Argument-completion row: render the name as-is (no leading `/`). */
	plain?: boolean;
}

export interface SlashMenuSection {
	group: SlashGroup;
	items: SlashMenuItem[];
}

const GROUP_ORDER: SlashGroup[] = [
	"session",
	"model",
	"status",
	"integration",
	"settings",
	"skill",
	"custom",
	"extension",
	"omp",
	"subcommand",
];

function sourceGroup(source: string | undefined): SlashGroup {
	switch (source) {
		case "skill":
			return "skill";
		case "custom":
		case "file":
			return "custom";
		case "extension":
		case "mcp_prompt":
			return "extension";
		default:
			return "omp";
	}
}

const GROUP_KEY_ICON: Record<SlashGroup, SlashCommandDef["icon"]> = {
	session: BookMarked,
	model: BookMarked,
	status: BookMarked,
	integration: BookMarked,
	settings: BookMarked,
	skill: BookMarked,
	custom: FileText,
	extension: Puzzle,
	omp: Terminal,
	subcommand: Terminal,
	mcp: BookMarked,
	plugin: BookMarked,
};
interface ScoredItem {
	item: SlashMenuItem;
	score: number;
}

const subMatches = (q: string, sub: SlashSubcommand) => sub.name.toLowerCase().includes(q);

/** Keep a parent in the results when only one of its subcommands matches. */
function withSubMatch(q: string, score: number, item: SlashMenuItem): number {
	if (score >= 0 || !q) return score;
	return item.subcommands?.some((s) => subMatches(q, s)) ? 7 : -1;
}

/** Subcommand rows listed (indented) under a parent in the top-level menu:
 * all of them when the parent matched by name, else only the matching ones. */
function nestedSubRows(q: string, parentScore: number, parent: SlashMenuItem): SlashMenuItem[] {
	if (!q || !parent.subcommands?.length) return [];
	const subs = parentScore <= 2 ? parent.subcommands : parent.subcommands.filter((s) => subMatches(q, s));
	return subs.map((sub) => ({
		name: sub.name,
		subOf: parent.name,
		parentTitle: parent.title,
		nested: true,
		title: "",
		description: sub.description ?? "",
		argHint: sub.usage,
		group: parent.group,
		icon: parent.icon,
		registry: parent.registry,
	}));
}

/** Lower score = better. -1 rejects. Subsequence name matches rank last. */
function matchScore(query: string, c: {
	name: string;
	aliases?: string[];
	title: string;
	description: string;
}): number {
	if (!query) return 10;
	const name = c.name.toLowerCase();
	if (name.startsWith(query)) return 0;
	if (name.includes(query)) return 1;
	if ((c.aliases ?? []).some((a) => a.toLowerCase().startsWith(query)))
		return 2;
	if (c.title.toLowerCase().includes(query)) return 3;
	if (c.description.toLowerCase().includes(query)) return 4;
	// loose subsequence match on the name ("cmpt" → compact)
	let i = 0;
	for (const ch of name) if (ch === query[i]) i++;
	return i === query.length ? 6 : -1;
}

/** Subcommands omp's RPC handler rejects (they need the TUI: editor, HUD,
 * OAuth/browser flows). The catalog carries no per-subcommand flag, so they
 * are filtered by name; everything else comes from the live catalog. */
const TUI_ONLY_SUBCOMMANDS: Record<string, readonly string[]> = {
	todo: ["edit", "expand", "collapse"],
	advisor: ["configure"],
	mcp: ["reauth", "unauth", "smithery-login", "smithery-logout", "reconnect", "notifications"],
};

/** omp commands the app drives itself (the plan review panel's actions). */
const HOST_ONLY_COMMANDS: ReadonlySet<string> = new Set(["plan-action"]);

function runnableSubs(parent: string, subs: SlashSubcommand[] | undefined): SlashSubcommand[] {
	const banned = TUI_ONLY_SUBCOMMANDS[parent];
	return (subs ?? []).filter((s) => s.name && !banned?.includes(s.name));
}

function toItem(def: SlashCommandDef, commands: SlashCommand[]): SlashMenuItem {
	const subcommands = subcommandsFor(def.name, commands);
	return {
		name: def.name,
		get title() {
			return def.title;
		},
		get description() {
			return def.description;
		},
		icon: def.icon,
		group: def.group,
		get argHint() {
			return def.argHint;
		},
		settingsTarget: def.settingsTarget,
		registry: true,
		...(subcommands.length ? { subcommands } : {}),
	};
}

function toDynamicItem(c: SlashCommand): SlashMenuItem {
	const subs = runnableSubs(c.name, c.subcommands);
	return {
		name: c.name,
		title: "",
		description: c.description ?? "",
		get icon() {
			return GROUP_KEY_ICON[sourceGroup(c.source)] ?? Terminal;
		},
		group: sourceGroup(c.source),
		get argHint() {
			return c.hint ?? c.input?.hint ?? (subs.length ? tNow("slash.subcommandHint") : undefined);
		},
		registry: false,
		...(subs.length ? { subcommands: subs } : {}),
	};
}

/** App-feature toggles that hide menu items (omitted = feature on). */
export interface SlashMenuOpts {
	visualizeEnabled?: boolean;
}

/**
 * Build grouped menu sections for a `/` query.
 * Registry commands win over dynamic omp commands of the same name/alias.
 * `composerHasOtherText` hides `requiresEmptyComposer` commands;
 * `opts.visualizeEnabled === false` hides the Visualize entry.
 */
export function buildSlashSections(
	query: string,
	commands: SlashCommand[],
	composerHasOtherText: boolean,
	opts?: SlashMenuOpts,
): SlashMenuSection[] {
	const q = query.toLowerCase();
	const scored: ScoredItem[] = [];

	for (const def of SLASH_COMMANDS) {
		if (composerHasOtherText && def.requiresEmptyComposer) continue;
		if (def.feature === "visualize" && opts?.visualizeEnabled === false) continue;
		const item = toItem(def, commands);
		const score = withSubMatch(q, matchScore(q, def), item);
		if (score >= 0) scored.push({ item, score });
	}

	// Names/aliases already covered by the registry.
	const taken = new Set<string>();
	for (const def of SLASH_COMMANDS) {
		taken.add(def.name);
		for (const a of def.aliases ?? []) taken.add(a);
	}
	const seen = new Set<string>();
	for (const c of commands) {
		if (taken.has(c.name) || seen.has(c.name) || HOST_ONLY_COMMANDS.has(c.name)) continue;
		if (c.aliases?.some((a) => taken.has(a))) continue;
		seen.add(c.name);
		const item = toDynamicItem(c);
		const score = withSubMatch(q, matchScore(q, {
			name: c.name,
			aliases: c.aliases,
			title: "",
			description: c.description ?? "",
		}), item);
		if (score >= 0) scored.push({ item, score });
	}

	scored.sort(
		(a, b) =>
			GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) ||
			a.score - b.score ||
			a.item.name.localeCompare(b.item.name),
	);

	const sections: SlashMenuSection[] = [];
	const push = (item: SlashMenuItem) => {
		const last = sections[sections.length - 1];
		if (last && last.group === item.group) last.items.push(item);
		else sections.push({ group: item.group, items: [item] });
	};
	for (const { item, score } of scored) {
		push(item);
		for (const row of nestedSubRows(q, score, item)) push(row);
	}
	return sections;
}

export function flattenSections(sections: SlashMenuSection[]): SlashMenuItem[] {
	return sections.flatMap((s) => s.items);
}

/** omp's dynamic entry for a registry command (by its name, then aliases),
 * looked up independently of the registry shadowing in buildSlashSections. */
function dynamicFor(def: SlashCommandDef, commands: SlashCommand[]): SlashCommand | undefined {
	const names = [def.name, ...(def.aliases ?? [])];
	for (const n of names) {
		const hit = commands.find((c) => c.name === n && c.subcommands?.length);
		if (hit) return hit;
	}
	return commands.find(
		(c) => c.subcommands?.length && c.aliases?.some((a) => names.includes(a)),
	);
}

/** Subcommands of a command, from omp's live catalog only (registry command
 * by name/alias, or a dynamic command), minus TUI-only ones. */
export function subcommandsFor(name: string, commands: SlashCommand[]): SlashSubcommand[] {
	const def = findSlashCommand(name);
	const subs = def ? dynamicFor(def, commands)?.subcommands : commands.find((c) => c.name === name || c.aliases?.includes(name))?.subcommands;
	return runnableSubs(def?.name ?? name, subs);
}

/** Ghost hint for a chip made from `item` (subcommand-only commands get `<子命令>`). */
export function chipArgHint(item: SlashMenuItem): string | undefined {
	return item.argHint ?? (item.subcommands?.length ? tNow("slash.subcommandHint") : undefined);
}

/** One menu item per subcommand, filtered by `query` (prefix matches first). */
export function buildSubcommandItems(parent: SlashMenuItem, query: string): SlashMenuItem[] {
	const q = query.toLowerCase();
	const prefix: SlashMenuItem[] = [];
	const inner: SlashMenuItem[] = [];
	// A registry command keeps its native action as the list's first entry.
	const bare: SlashMenuItem[] =
		parent.registry && !q
			? [
					{
						name: "",
						subOf: parent.name,
						bare: true,
						get title() {
							return parent.title;
						},
						get description() {
							return parent.description ? tNow("slash.subcommandDirectRunDesc", { desc: parent.description }) : tNow("slash.subcommandDirectRun");
						},
						group: "subcommand",
						icon: parent.icon,
						registry: true,
					},
				]
			: [];
	for (const sub of parent.subcommands ?? []) {
		const n = sub.name.toLowerCase();
		const item: SlashMenuItem = {
			name: sub.name,
			subOf: parent.name,
			title: "",
			description: sub.description ?? "",
			argHint: sub.usage,
			group: "subcommand",
			icon: parent.icon,
			registry: parent.registry,
		};
		if (n.startsWith(q)) prefix.push(item);
		else if (n.includes(q)) inner.push(item);
	}
	return [...bare, ...prefix, ...inner];
}

/** Item whose name/alias equals `token` exactly, only if it takes arguments. */
export function findCommandItemExact(token: string, commands: SlashCommand[]): SlashMenuItem | null {
	let item: SlashMenuItem | null = null;
	const def = SLASH_COMMANDS.find((d) => d.name === token || d.aliases?.includes(token));
	if (def) item = toItem(def, commands);
	else {
		const taken = new Set<string>();
		for (const d of SLASH_COMMANDS) {
			taken.add(d.name);
			for (const a of d.aliases ?? []) taken.add(a);
		}
		const c = commands.find(
			(x) =>
				(x.name === token || x.aliases?.includes(token)) &&
				!taken.has(x.name) &&
				!x.aliases?.some((a) => taken.has(a)),
		);
		if (c) item = toDynamicItem(c);
	}
	return item && (item.argHint || item.subcommands?.length) ? item : null;
}

export function findSubcommandExact(parent: SlashMenuItem, word: string): SlashSubcommand | null {
	return parent.subcommands?.find((s) => s.name === word) ?? null;
}
