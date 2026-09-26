/** [D] Official OMP settings tabs — grouping + labels for the OMP config panel. */

import type { OmpConfigEntry } from "../../lib/contracts";

/** Tab ids in the order `omp config list` prints them. */
export const OMP_TAB_ORDER: readonly string[] = [
	"appearance",
	"context",
	"files",
	"interaction",
	"internal",
	"memory",
	"model",
	"providers",
	"shell",
	"tasks",
	"tools",
];

const TAB_LABELS: Record<string, string> = {
	appearance: "外观",
	context: "上下文",
	files: "文件",
	interaction: "交互",
	internal: "内部",
	memory: "记忆",
	model: "模型",
	providers: "供应商",
	shell: "Shell",
	tasks: "任务",
	tools: "工具",
};

/** Chinese label for an official tab; unknown (future) tab ids render as-is. */
export function ompTabLabel(tab: string): string {
	return TAB_LABELS[tab] ?? tab;
}

export interface OmpTabGroup {
	id: string;
	label: string;
	entries: OmpConfigEntry[];
}

/** Top-level segment of a schema key (`theme.dark` → `theme`, `temperature` → `temperature`). */
export function keyPrefix(key: string): string {
	const dot = key.indexOf(".");
	return dot === -1 ? key : key.slice(0, dot);
}

/**
 * Group entries by their official OMP tab. Known tabs keep OMP's own order;
 * unknown (future) tab ids are appended alphabetically. Entries are key-sorted.
 */
export function groupByOmpTab(entries: OmpConfigEntry[]): OmpTabGroup[] {
	const byTab = new Map<string, OmpConfigEntry[]>();
	for (const entry of entries) {
		const list = byTab.get(entry.tab);
		if (list) {
			list.push(entry);
		} else {
			byTab.set(entry.tab, [entry]);
		}
	}
	const rank = new Map(OMP_TAB_ORDER.map((id, i) => [id, i]));
	const ids = [...byTab.keys()].sort((a, b) => {
		const ra = rank.get(a);
		const rb = rank.get(b);
		if (ra !== undefined && rb !== undefined) return ra - rb;
		if (ra !== undefined) return -1;
		if (rb !== undefined) return 1;
		return a.localeCompare(b);
	});
	return ids.map((id) => {
		const list = byTab.get(id) ?? [];
		list.sort((a, b) => a.key.localeCompare(b.key));
		return { id, label: ompTabLabel(id), entries: list };
	});
}

/** Group one tab's entries by exact top-level prefix, prefix-sorted. */
export function groupByPrefix(entries: OmpConfigEntry[]): [string, OmpConfigEntry[]][] {
	const byPrefix = new Map<string, OmpConfigEntry[]>();
	for (const entry of entries) {
		const prefix = keyPrefix(entry.key);
		const list = byPrefix.get(prefix);
		if (list) {
			list.push(entry);
		} else {
			byPrefix.set(prefix, [entry]);
		}
	}
	return [...byPrefix.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([prefix, list]) => {
			list.sort((a, b) => a.key.localeCompare(b.key));
			return [prefix, list] as [string, OmpConfigEntry[]];
		});
}
