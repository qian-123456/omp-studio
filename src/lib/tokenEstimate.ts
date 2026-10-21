/**
 * Rough token range shown next to rule/memory files. Real counts depend on the model's
 * tokenizer, so this returns bounds from common rules of thumb (not measured):
 * - CJK characters: 0.7 – 1.5 tokens each.
 * - Everything else: 1 token per 4 chars (plain English) up to 1 per 2.5 chars (code, paths, symbols).
 */

const CJK_LOW = 0.7;
const CJK_HIGH = 1.5;
const OTHER_LOW_DIV = 4;
const OTHER_HIGH_DIV = 2.5;

function isCjk(cp: number): boolean {
	return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xff00 && cp <= 0xffef);
}

export interface TokenRange {
	low: number;
	high: number;
}

export function estimateTokenRange(text: string): TokenRange {
	let cjk = 0;
	let other = 0;
	for (const ch of text) {
		if (isCjk(ch.codePointAt(0) ?? 0)) cjk += 1;
		else other += 1;
	}
	if (cjk + other === 0) return { low: 0, high: 0 };
	return {
		low: Math.max(1, Math.round(cjk * CJK_LOW + other / OTHER_LOW_DIV)),
		high: Math.max(1, Math.ceil(cjk * CJK_HIGH + other / OTHER_HIGH_DIV)),
	};
}

function compact(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** 「约 250–400 token」; collapses to a single number when both bounds round the same. */
export function formatTokenEstimate(text: string): string {
	const { low, high } = estimateTokenRange(text);
	const l = compact(low);
	const h = compact(high);
	return l === h ? `约 ${l} token` : `约 ${l}–${h} token`;
}
