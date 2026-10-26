/** Detects provider errors caused by the prompt exceeding the model's context window. */
const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
	/prompt is too long/i,
	/context_length_exceeded/i,
	/maximum context length/i,
	/context window exceeded/i,
	/exceeds? (the )?(model'?s? )?context (window|length)/i,
	/too many tokens/i,
];

export function isContextOverflowError(text: string | null | undefined): boolean {
	if (!text) return false;
	return CONTEXT_OVERFLOW_PATTERNS.some((re) => re.test(text));
}

/** Split a transcript model ref (`provider/model` or bare `model`) for settings deep links. */
export function splitModelRef(
	ref: string | null | undefined,
): { providerId: string | null; modelId: string } | null {
	const s = ref?.trim();
	if (!s) return null;
	const slash = s.indexOf("/");
	if (slash <= 0 || slash === s.length - 1) return { providerId: null, modelId: s };
	return { providerId: s.slice(0, slash), modelId: s.slice(slash + 1) };
}

/**
 * Pure logic for context window overflow detection and candidate model
 * selection when compacting over-limit sessions.
 */
import type { TranscriptItem } from "../../lib/contracts";
import { type ModelOption, toModelKey } from "../../lib/models";

/** Formats token numbers to concise display strings (e.g. "2k", "12.7k", "200k", "1.0M"). */
export function compactTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n >= 1_000_000) {
		const v = (n / 1_000_000).toFixed(1);
		return v.endsWith(".0") ? `${Math.round(n / 1_000_000)}M` : `${v}M`;
	}
	if (n >= 1_000) {
		const v = (n / 1_000).toFixed(1);
		return v.endsWith(".0") ? `${Math.round(n / 1_000)}k` : `${v}k`;
	}
	return String(Math.round(n));
}

export interface OverflowCheckParams {
	contextTokens?: number | null;
	contextWindow?: number | null;
}

/**
 * Returns true when the active or target model's declared context window is
 * smaller than the session's current token usage.
 */
export function isContextOverflow({ contextTokens, contextWindow }: OverflowCheckParams): boolean {
	if (
		typeof contextTokens !== "number" ||
		typeof contextWindow !== "number" ||
		contextTokens <= 0 ||
		contextWindow <= 0
	) {
		return false;
	}
	return contextTokens > contextWindow;
}

/**
 * Extracts the most recent model previously used in the session transcript
 * that differs from the currently selected model.
 */
export function findPreviousSessionModel(
	items?: TranscriptItem[] | null,
	currentModelKey?: string | null,
): string | null {
	if (!items || !items.length) return null;
	const curKey = currentModelKey ? currentModelKey.trim().toLowerCase() : null;

	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		const model = item.model?.trim();
		if (!model) continue;
		const modelLower = model.toLowerCase();
		if (curKey && (modelLower === curKey || curKey.endsWith(`/${modelLower}`))) {
			continue;
		}
		return model;
	}
	return null;
}

export interface CandidateModelParams {
	models: ModelOption[] | null | undefined;
	currentTokens: number;
	previousModelKey?: string | null;
	currentModelKey?: string | null;
}

/**
 * Picks a candidate model whose context window is >= current session tokens.
 *
 * Preference order:
 * 1. The session's previously-used model, if its window accommodates currentTokens.
 * 2. Another model from the same provider as currentModelKey, if large enough.
 * 3. The candidate with the largest context window in the catalog.
 */
export function findCandidateCompactionModel({
	models,
	currentTokens,
	previousModelKey,
	currentModelKey,
}: CandidateModelParams): ModelOption | null {
	if (!models || !models.length || currentTokens <= 0) return null;

	// Eligible models whose declared window can hold current tokens
	const fitting = models.filter(
		(m) => typeof m.contextWindow === "number" && m.contextWindow >= currentTokens,
	);
	if (!fitting.length) return null;

	// 1. Try previous model
	if (previousModelKey) {
		const prev = previousModelKey.trim().toLowerCase();
		const prevMatch = fitting.find((m) => {
			const key = toModelKey(m.provider, m.id).toLowerCase();
			return key === prev || m.id.toLowerCase() === prev;
		});
		if (prevMatch) return prevMatch;
	}

	// 2. Try same provider as current model
	let currentProvider: string | null = null;
	if (currentModelKey) {
		const slash = currentModelKey.indexOf("/");
		if (slash > 0) currentProvider = currentModelKey.slice(0, slash).toLowerCase();
	}
	if (currentProvider) {
		const sameProvider = fitting.filter(
			(m) => m.provider.toLowerCase() === currentProvider,
		);
		if (sameProvider.length > 0) {
			sameProvider.sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
			return sameProvider[0];
		}
	}

	// 3. Fallback: candidate with largest context window
	const sorted = [...fitting].sort(
		(a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0),
	);
	return sorted[0];
}
