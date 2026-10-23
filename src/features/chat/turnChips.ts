/** Pure helpers for the per-turn rollback action (rendered by AnswerFooter). */
import type { TurnCheckpoint } from "../../lib/contracts";

/**
 * A turn may offer 「撤回这一轮」 when it changed files, its snapshot refs are
 * still present, it has not been undone already, and the session is not
 * mid-turn. Any turn of the session may be rolled back — not just the newest.
 */
export function canUndoTurn(
	turn: TurnCheckpoint,
	sessionWorking: boolean,
): boolean {
	return (
		!sessionWorking && turn.restorable && !turn.undone && turn.files.length > 0
	);
}

/**
 * Rolling back `target` returns the workspace to its state before that turn
 * started, so every LATER non-undone turn of the same session is rolled back
 * too. Returns the cascade (target plus those later turns), newest first;
 * an empty array when `turns` does not contain the target.
 */
export function undoCascade(
	turns: TurnCheckpoint[],
	target: TurnCheckpoint,
): TurnCheckpoint[] {
	const idx = turns.findIndex((t) => t.turnId === target.turnId);
	if (idx < 0) return [];
	return turns.slice(idx).filter((t) => !t.undone).reverse();
}
