/**
 * Debounced "the final answer has started" signal for an in-flight turn.
 *
 * Interim prose looks exactly like the start of the answer until a tool call
 * follows it, usually within a moment. The signal therefore latches only after
 * a candidate has been the trailing step for `ANSWER_START_DELAY_MS`, and drops
 * as soon as the candidate disappears (a tool or reasoning row followed it).
 * `settled` (the stream ended) latches immediately so a short answer lands in
 * the same shape the committed turn renders.
 */

import { useEffect, useState } from "react";

export const ANSWER_START_DELAY_MS = 500;

export function useAnswerStarted(hasCandidate: boolean, settled: boolean): boolean {
	const [latched, setLatched] = useState(false);

	useEffect(() => {
		if (!hasCandidate) {
			setLatched(false);
			return;
		}
		if (settled) {
			setLatched(true);
			return;
		}
		const timer = window.setTimeout(() => setLatched(true), ANSWER_START_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [hasCandidate, settled]);

	// A candidate that has not latched yet must not read as started when the
	// effect has not run (first render after settling).
	return hasCandidate && (latched || settled);
}
