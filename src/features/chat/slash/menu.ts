/** [B] Slash menu model: merge registry + omp dynamic commands into
 * grouped, fuzzy-filtered menu items. Pure functions (testable). */

import {
	BookMarked,
	FileText,
	Puzzle,
	Terminal,
} from "lucide-react";
import type { SlashCommand } from "../../../stores/live";
import { SLASH_COMMANDS } from "./registry";
import type { SlashCommandDef, SlashGroup } from "./types";

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
}

export interface SlashMenuSection {
	label: SlashGroup;
	items: SlashMenuItem[];
}

const GROUP_ORDER: SlashGroup[] = [
	"会话",
	"模型",
	"状态",
	"集成",
	"设置",
	"技能",
	"自定义命令",
	"扩展",
	"更多 OMP 命令",
];

const SOURCE_GROUP: Record<string, SlashGroup> = {
	skill: "技能",
	custom: "自定义命令",
	file: "自定义命令",
	extension: "扩展",
	mcp_prompt: "扩展",
};

const GROUP_ICON: Record<string, SlashCommandDef["icon"]> = {
	技能: BookMarked,
	自定义命令: FileText,
	扩展: Puzzle,
	"更多 OMP 命令": Terminal,
};

interface ScoredItem {
	item: SlashMenuItem;
	score: number;
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

function toItem(def: SlashCommandDef): SlashMenuItem {
	return {
		name: def.name,
		title: def.title,
		description: def.description,
		icon: def.icon,
		group: def.group,
		argHint: def.argHint,
		settingsTarget: def.settingsTarget,
		registry: true,
	};
}

function toDynamicItem(c: SlashCommand): SlashMenuItem {
	const group = SOURCE_GROUP[c.source ?? ""] ?? "更多 OMP 命令";
	return {
		name: c.name,
		title: "",
		description: c.description ?? "",
		icon: GROUP_ICON[group],
		group,
		argHint: c.hint ?? c.input?.hint,
		registry: false,
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
		const score = matchScore(q, def);
		if (score >= 0) scored.push({ item: toItem(def), score });
	}

	// Names/aliases already covered by the registry.
	const taken = new Set<string>();
	for (const def of SLASH_COMMANDS) {
		taken.add(def.name);
		for (const a of def.aliases ?? []) taken.add(a);
	}
	const seen = new Set<string>();
	for (const c of commands) {
		if (taken.has(c.name) || seen.has(c.name)) continue;
		if (c.aliases?.some((a) => taken.has(a))) continue;
		seen.add(c.name);
		const score = matchScore(q, {
			name: c.name,
			aliases: c.aliases,
			title: "",
			description: c.description ?? "",
		});
		if (score >= 0) scored.push({ item: toDynamicItem(c), score });
	}

	scored.sort(
		(a, b) =>
			GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) ||
			a.score - b.score ||
			a.item.name.localeCompare(b.item.name),
	);

	const sections: SlashMenuSection[] = [];
	for (const { item } of scored) {
		const last = sections[sections.length - 1];
		if (last && last.label === item.group) last.items.push(item);
		else sections.push({ label: item.group, items: [item] });
	}
	return sections;
}

export function flattenSections(sections: SlashMenuSection[]): SlashMenuItem[] {
	return sections.flatMap((s) => s.items);
}
