import { describe, expect, it } from "vitest";
import type { TurnCheckpoint } from "../../lib/contracts";
import { undoableTurn } from "./turnChips";

function makeTurn(turnId: string, userItemId: string | null, extra: Partial<TurnCheckpoint> = {}): TurnCheckpoint {
	return {
		turnId,
		sessionId: "s1",
		userItemId,
		prompt: "p",
		before: "b" + turnId,
		after: "a" + turnId,
		headBefore: null,
		headAfter: null,
		commits: [],
		files: [{ path: "x.ts", status: "M" }],
		endedAt: "2026-09-30T00:00:00Z",
		restorable: true,
		undone: false,
		...extra,
	};
}

describe("undoableTurn", () => {
	it("returns the newest turn when restorable, not undone, and idle", () => {
		const turns = [makeTurn("t1", "u1"), makeTurn("t2", "u2")];
		expect(undoableTurn(turns, false)?.turnId).toBe("t2");
	});

	it("never offers undo while the session is working", () => {
		const turns = [makeTurn("t1", "u1")];
		expect(undoableTurn(turns, true)).toBeNull();
	});

	it("hides the action when the newest turn is already undone or pruned", () => {
		expect(undoableTurn([makeTurn("t1", "u1", { undone: true })], false)).toBeNull();
		expect(undoableTurn([makeTurn("t1", "u1", { restorable: false })], false)).toBeNull();
		expect(undoableTurn([], false)).toBeNull();
	});

	it("does not offer undo on an older turn even if it is eligible", () => {
		// Newest is undone → nothing is undoable (Rust also rejects non-newest).
		const turns = [
			makeTurn("t1", "u1"),
			makeTurn("t2", "u2", { undone: true }),
		];
		expect(undoableTurn(turns, false)).toBeNull();
	});
});
