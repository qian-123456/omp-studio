import { describe, expect, it } from "vitest";
import type { TurnCheckpoint } from "../../lib/contracts";
import { canUndoTurn, undoCascade } from "./turnChips";

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

describe("canUndoTurn", () => {
	it("allows the newest turn when restorable, undone=false, files present, idle", () => {
		expect(canUndoTurn(makeTurn("t2", "u2"), false)).toBe(true);
	});

	it("allows an OLDER turn that has file changes", () => {
		// Newest stays eligible too — both may offer the button now.
		expect(canUndoTurn(makeTurn("t1", "u1"), false)).toBe(true);
	});

	it("never offers undo while the session is working", () => {
		expect(canUndoTurn(makeTurn("t1", "u1"), true)).toBe(false);
	});

	it("hides the action when undone, pruned, or file-less", () => {
		expect(canUndoTurn(makeTurn("t1", "u1", { undone: true }), false)).toBe(false);
		expect(canUndoTurn(makeTurn("t1", "u1", { restorable: false }), false)).toBe(false);
		expect(canUndoTurn(makeTurn("t1", "u1", { files: [] }), false)).toBe(false);
	});
});

describe("undoCascade", () => {
	it("is just the target when it is the newest turn", () => {
		const turns = [makeTurn("t1", "u1"), makeTurn("t2", "u2")];
		const cascade = undoCascade(turns, turns[1]);
		expect(cascade.map((t) => t.turnId)).toEqual(["t2"]);
	});

	it("includes every later non-undone turn, newest first", () => {
		const turns = [
			makeTurn("t1", "u1"),
			makeTurn("t2", "u2"),
			makeTurn("t3", "u3", { files: [] }), // no files — still rolled back
		];
		const cascade = undoCascade(turns, turns[0]);
		expect(cascade.map((t) => t.turnId)).toEqual(["t3", "t2", "t1"]);
	});

	it("skips later turns that are already undone", () => {
		const turns = [
			makeTurn("t1", "u1"),
			makeTurn("t2", "u2", { undone: true }),
			makeTurn("t3", "u3"),
		];
		const cascade = undoCascade(turns, turns[0]);
		expect(cascade.map((t) => t.turnId)).toEqual(["t3", "t1"]);
	});

	it("returns empty when the target is not in the list", () => {
		expect(undoCascade([makeTurn("t1", "u1")], makeTurn("t9", "u9"))).toEqual([]);
	});
});
