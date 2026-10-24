import { tNow } from "../../stores/language";
/** Responsive tiers for the composer toolbar. The toolbar never wraps: as its own
 * width shrinks, lower-value elements collapse first (in this order):
 *   0 full      model chip + thinking chip + ring with 「53%」
 *   1 noPercent ring only (percentage stays in its tooltip)
 *   2 tight     tighter chip padding and gaps
 *   3 merged    ONE chip 「model · level」; its popover holds the thinking choice
 *   4 badge     merged chip with an abbreviated level (「hi」)
 * Widths are estimates from the label text; the last tier is the fallback when
 * nothing fits. */

export type ToolbarTier = 0 | 1 | 2 | 3 | 4;

export const TIER_FULL = 0;
export const TIER_NO_PERCENT = 1;
export const TIER_TIGHT = 2;
export const TIER_MERGED = 3;
export const TIER_BADGE = 4;

/** What the thinking chip shows for the selected model. */
export type ThinkingKind = "levels" | "unconfigured" | "unsupported";

const CJK = /[\u2e80-\u9fff\uff00-\uffef]/;

/** Rendered width estimate of 12px UI text. */
export function textWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += CJK.test(ch) ? 12 : 6.6;
	return w;
}

const ABBREV: Record<string, string> = {
	auto: "auto",
	off: "off",
	minimal: "min",
	low: "low",
	medium: "mid",
	high: "hi",
	xhigh: "xhi",
	max: "max",
};

/** Short form of a thinking level for the narrowest toolbar. */
export function abbreviateThinking(level: string): string {
	return ABBREV[level] ?? level.slice(0, 3);
}

/** Text appended after the model name in the merged chip (「 · high」), or "" when none. */
export function mergedSuffix(kind: ThinkingKind, level: string, abbreviated: boolean): string {
	if (kind === "levels") return ` · ${abbreviated ? abbreviateThinking(level) : level}`;
	if (kind === "unconfigured") return ` · ${tNow("chat.toolbar.unconfigured")}`;
	return "";
}

export interface ToolbarMeasure {
	/** Toolbar content-box width in px (0 = not measured yet). */
	width: number;
	modelLabel: string;
	thinkingKind: ThinkingKind;
	thinkingLevel: string;
	/** Extra fixed-width items on the row (plan icon, queue pill), px. */
	extra?: number;
}

const FIXED = 20 /* px-2.5 */ + 28 /* + button */ + 8 /* gap-x */ + 28 /* send */ + 6; /* right gap */
const CHIP_PAD = 30; /* px-2 + gap + chevron */
const RING = 30;
const RING_PCT = 62;

function thinkingChipWidth(kind: ThinkingKind, level: string): number {
	if (kind === "levels") return CHIP_PAD + textWidth(level);
	if (kind === "unconfigured") return 18 + textWidth(tNow("chat.toolbar.unconfiguredThinking"));
	return 18 + textWidth(tNow("chat.toolbar.unsupportedThinking"));
}

export function pickToolbarTier(m: ToolbarMeasure): ToolbarTier {
	if (m.width <= 0) return TIER_FULL;
	const base = FIXED + (m.extra ?? 0);
	const model = CHIP_PAD + textWidth(m.modelLabel);
	const thinking = thinkingChipWidth(m.thinkingKind, m.thinkingLevel);
	const need: Record<ToolbarTier, number> = {
		0: base + model + thinking + 2 + RING_PCT,
		1: base + model + thinking + 2 + RING,
		2: base + model + thinking + 2 + RING - 12,
		3: base + model + textWidth(mergedSuffix(m.thinkingKind, m.thinkingLevel, false)) + RING - 12,
		4: base + model + textWidth(mergedSuffix(m.thinkingKind, m.thinkingLevel, true)) + RING - 12,
	};
	for (const t of [0, 1, 2, 3] as const) if (need[t] <= m.width) return t;
	return TIER_BADGE;
}
