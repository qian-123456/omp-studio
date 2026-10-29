/** Transient highlight of an annotation's quoted text inside a rendered message.
 * Used by "定位到原消息": scroll to the exact quote, flash it, and report whether
 * it was found so callers can fall back to highlighting the whole message. */

import { collectTextSegments, locateQuote, messageQuoteRoot, segmentRange } from "./annotationAnchor";

const LOCATE_HIGHLIGHT = "annotation-locate";
const POLL_MS = 80;
/** Long enough for a smooth scroll to mount a virtualized-out row. */
const MAX_WAIT_MS = 1500;

let clearTimer = 0;

/**
 * Occurrence hints for 「定位到原消息」: the locate request travels through the
 * live store as (itemId, quote) only, so the annotation's recorded occurrence
 * is parked here, keyed the same way, until the quote is located.
 */
const occurrenceHints = new Map<string, { occurrence?: number; answerPart?: number }>();
const hintKey = (itemId: string, quote: string) => `${itemId}\u0000${quote}`;

export function setQuoteOccurrenceHint(itemId: string, quote: string, occurrence?: number, answerPart?: number): void {
	if (occurrence === undefined && answerPart === undefined) occurrenceHints.delete(hintKey(itemId, quote));
	else occurrenceHints.set(hintKey(itemId, quote), { occurrence, answerPart });
}

/** The virtualizer must mount the selected slice, not merely the first answer row. */
export function quoteAnswerPartHint(itemId: string, quote?: string): number | undefined {
	return quote === undefined ? undefined : occurrenceHints.get(hintKey(itemId, quote))?.answerPart;
}

/** Range of `quote` inside the rendered message `msg-<itemId>`, or null. */
export function findQuoteRange(itemId: string, quote: string): Range | null {
	const key = hintKey(itemId, quote);
	const hint = occurrenceHints.get(key);
	const el = messageQuoteRoot(itemId, hint?.answerPart);
	if (!el) return null;
	const { text, segments } = collectTextSegments(el);
	const hit = locateQuote(text, quote, hint?.occurrence);
	if (!hit) return null;
	// One-shot: the hint only serves the click that set it (kept while the text is still rendering).
	occurrenceHints.delete(key);
	return segmentRange(segments, hit.start, hit.end);
}

/**
 * Waits for the message to render, then scrolls to and highlights the quote for
 * `ms`. Resolves false when the quote cannot be located (or highlights are
 * unsupported) so the caller can highlight the whole message instead.
 */
export function flashQuote(itemId: string, quote: string, ms: number): Promise<boolean> {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return Promise.resolve(false);
	let resolve!: (found: boolean) => void;
	const promise = new Promise<boolean>((r) => {
		resolve = r;
	});
	const started = Date.now();
	const attempt = () => {
		const range = findQuoteRange(itemId, quote);
		if (range) {
			range.startContainer.parentElement?.scrollIntoView({
				behavior: "smooth",
				block: "center",
			});
			CSS.highlights.set(LOCATE_HIGHLIGHT, new Highlight(range));
			window.clearTimeout(clearTimer);
			clearTimer = window.setTimeout(() => CSS.highlights.delete(LOCATE_HIGHLIGHT), ms);
			resolve(true);
		} else if (Date.now() - started >= MAX_WAIT_MS) {
			resolve(false);
		} else {
			window.setTimeout(attempt, POLL_MS);
		}
	};
	attempt();
	return promise;
}
