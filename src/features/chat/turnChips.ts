/**
 * Pure helpers for the per-turn checkpoint chips in the chat stream.
 * A turn = the user item (`userItemId`) up to the item before the next user
 * item; the chip renders after that last item of the turn.
 */
import type { TranscriptItem, TurnCheckpoint } from "../../lib/contracts";

/**
 * Index (into `items`) after which each checkpoint's chip renders.
 * Checkpoints whose `userItemId` is missing from `items` are skipped;
 * `items` is the *visible* row list so the chip lands on a rendered row.
 */
export function turnChipTargets(
	items: TranscriptItem[],
	turns: TurnCheckpoint[],
): Map<number, TurnCheckpoint[]> {
	// For every position, the index of the next user item strictly after it
	// (-1 = none); a user item points at the following turn's start.
	const nextUserAfter = new Map<number, number>();
	let nextUser = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		nextUserAfter.set(i, nextUser);
		if (items[i].kind === "user") nextUser = i;
	}
	const indexById = new Map(items.map((it, i) => [it.id, i]));
	const targets = new Map<number, TurnCheckpoint[]>();
	for (const turn of turns) {
		if (!turn.userItemId) continue;
		const start = indexById.get(turn.userItemId);
		if (start === undefined) continue;
		const boundary = nextUserAfter.get(start) ?? -1;
		const at = boundary > start ? boundary - 1 : items.length - 1;
		const list = targets.get(at);
		if (list) list.push(turn);
		else targets.set(at, [turn]);
	}
	return targets;
}

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
