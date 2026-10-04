/** Pure helper for the per-turn undo action (rendered by AnswerFooter). */
import type { TurnCheckpoint } from "../../lib/contracts";

/**
 * Only the newest checkpoint (turns arrive oldest-first) may offer
 * 「撤回这一轮」, and only while restorable, not yet undone, and the session
 * is not mid-turn.
 */
export function undoableTurn(
	turns: TurnCheckpoint[],
	sessionWorking: boolean,
): TurnCheckpoint | null {
	if (sessionWorking) return null;
	const newest = turns[turns.length - 1];
	return newest && newest.restorable && !newest.undone ? newest : null;
}
