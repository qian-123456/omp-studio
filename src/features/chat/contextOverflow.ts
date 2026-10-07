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
