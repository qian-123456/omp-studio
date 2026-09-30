import { describe, expect, it } from "vitest";
import type { TranscriptItem, TurnCheckpoint } from "../../lib/contracts";
import { turnChipTargets, undoableTurn } from "./turnChips";

function makeItem(id: string, kind: TranscriptItem["kind"]): TranscriptItem {
	return {
		id,
		parentId: null,
		ts: "2026-09-30T00:00:00Z",
		kind,
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
	};
}

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

describe("turnChipTargets", () => {
	const items = [
		makeItem("u1", "user"),
		makeItem("a1", "assistant"),
		makeItem("a2", "assistant"),
		makeItem("u2", "user"),
		makeItem("a3", "assistant"),
		makeItem("sys", "system"),
	];

	it("places the chip after the last item before the next user item", () => {
		const targets = turnChipTargets(items, [makeTurn("t1", "u1"), makeTurn("t2", "u2")]);
		expect(targets.get(2)?.map((t) => t.turnId)).toEqual(["t1"]); // a2
		expect(targets.get(5)?.map((t) => t.turnId)).toEqual(["t2"]); // end of stream
	});

	it("stacks multiple turns that share the same boundary", () => {
		const targets = turnChipTargets(items, [
			makeTurn("t1", "u1"),
			makeTurn("t2", "u1"),
		]);
		expect(targets.get(2)?.map((t) => t.turnId)).toEqual(["t1", "t2"]);
	});

	it("attaches to the user item itself when nothing follows it", () => {
		const single = [makeItem("u1", "user")];
		const targets = turnChipTargets(single, [makeTurn("t1", "u1")]);
		expect(targets.get(0)?.map((t) => t.turnId)).toEqual(["t1"]);
	});

	it("skips turns whose user item is absent or has no userItemId", () => {
		const targets = turnChipTargets(items, [
			makeTurn("gone", "u_missing"),
			makeTurn("noid", null),
		]);
		expect(targets.size).toBe(0);
	});
});

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
