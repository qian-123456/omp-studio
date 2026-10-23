import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../../lib/contracts";
import { buildShareEntries, listShareableIds } from "./shareEntries";
import { useShareSelection } from "./shareStore";

function item(over: Partial<TranscriptItem> & Pick<TranscriptItem, "id" | "kind">): TranscriptItem {
	return {
		parentId: null,
		ts: "2026-01-01T00:00:00.000Z",
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...over,
	};
}

const transcript: TranscriptItem[] = [
	item({ id: "u1", kind: "user", text: "first question" }),
	item({ id: "a1", kind: "assistant", text: "first answer", stopReason: "stop" }),
	item({ id: "u2", kind: "user", text: "second question" }),
	item({ id: "a2", kind: "assistant", text: "partial", stopReason: "aborted" }),
	item({ id: "u3", kind: "user", text: "third question" }),
	item({ id: "a3", kind: "assistant", text: "third answer", stopReason: "stop" }),
];

describe("share entries", () => {
	it("lists shareable ids in transcript order, skipping aborted answers", () => {
		expect(listShareableIds(transcript)).toEqual(["u1", "a1", "u2", "u3", "a3"]);
	});

	it("builds entries in transcript order regardless of selection order", () => {
		const entries = buildShareEntries(transcript, new Set(["a3", "u1", "a1"]));
		expect(entries.map((e) => [e.role, e.id])).toEqual([
			["user", "u1"],
			["assistant", "a1"],
			["assistant", "a3"],
		]);
	});

	it("ignores selected ids that are not shareable", () => {
		expect(buildShareEntries(transcript, new Set(["a2", "nope"]))).toEqual([]);
	});
});

describe("share selection store", () => {
	beforeEach(() => useShareSelection.getState().cancel());

	it("begin replaces the selection and toggle adds/removes", () => {
		const s = useShareSelection.getState();
		s.begin("s1", ["a", "a", "b"]);
		expect(useShareSelection.getState().selectedIds).toEqual(["a", "b"]);
		useShareSelection.getState().toggle("c");
		useShareSelection.getState().toggle("a");
		expect(useShareSelection.getState().selectedIds).toEqual(["b", "c"]);
		useShareSelection.getState().cancel();
		expect(useShareSelection.getState()).toMatchObject({ sessionId: null, selectedIds: [] });
	});
});
