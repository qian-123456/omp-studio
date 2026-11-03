// @vitest-environment jsdom
/** Conversation-tree path helpers: root→leaf filtering, effective leaf
 * extension while streaming, and sibling version grouping. */
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import {
	filterToLeafPath,
	leafPathIds,
	siblingVersions,
	versionsByItem,
} from "./treePath";

function item(
	id: string,
	parentId: string | null,
	kind: TranscriptItem["kind"] = "assistant",
	extra: Partial<TranscriptItem> = {},
): TranscriptItem {
	return {
		id,
		parentId,
		ts: "2026-01-01T00:00:00Z",
		kind,
		text: null,
		thinking: null,
		assistantParts: [],
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		images: [],
		hidden: false,
		duration: null,
		ttft: null,
		completedAt: null,
		firstKeptEntryId: null,
		...extra,
	};
}

/** user u1 → answer a1 ; later a sibling answer a2 (a navigated branch) and a
 * hidden sibling; tool chain under a1: tStart → result r1. */
function branchingTranscript(): TranscriptItem[] {
	return [
		item("root", null, "custom"),
		item("u1", "root", "user"),
		item("a1", "u1"),
		item("ts1", "a1", "custom"),
		item("r1", "ts1", "tool_result"),
		// A sibling answer of a1 in the same file (off the current path).
		item("a2", "u1"),
		// Hidden entries are never switchable.
		item("a3", "u1", "assistant", { hidden: true }),
	];
}

describe("filterToLeafPath", () => {
	it("returns items unchanged without a known leaf", () => {
		const items = branchingTranscript();
		expect(filterToLeafPath(items, null)).toBe(items);
	});

	it("returns items unchanged when the leaf id is not in the transcript", () => {
		const items = branchingTranscript();
		expect(filterToLeafPath(items, "ghost")).toBe(items);
	});

	it("keeps the root→leaf path and drops sibling branches", () => {
		const kept = filterToLeafPath(branchingTranscript(), "r1").map((i) => i.id);
		expect(kept).toEqual(["root", "u1", "a1", "ts1", "r1"]);
	});

	it("keeps a navigated sibling branch intact", () => {
		const kept = filterToLeafPath(branchingTranscript(), "a2").map((i) => i.id);
		expect(kept).toEqual(["root", "u1", "a2"]);
	});

	it("tolerates a parent chain loop without hanging", () => {
		const items = [item("x", "y"), item("y", "x")];
		expect(filterToLeafPath(items, "x").map((i) => i.id)).toEqual(["x", "y"]);
	});
});

describe("siblingVersions / versionsByItem", () => {
	it("counts same-kind siblings in file order and locates the on-path one", () => {
		const items = branchingTranscript();
		const v = siblingVersions(items, "r1", "a1");
		expect(v).toEqual({ index: 0, total: 2, ids: ["a1", "a2"] });
		const v2 = siblingVersions(items, "a2", "a2");
		expect(v2).toEqual({ index: 1, total: 2, ids: ["a1", "a2"] });
	});

	it("excludes hidden siblings", () => {
		const items = branchingTranscript();
		expect(siblingVersions(items, "r1", "a1")?.total).toBe(2);
	});

	it("returns null for entries without siblings or with no on-path sibling", () => {
		const items = branchingTranscript();
		expect(siblingVersions(items, "r1", "u1")).toBeNull();
		// A group whose members are all off-path (leaf above the fork point).
		expect(siblingVersions(items, "root", "a1")).toBeNull();
		// The user entry itself rewound past (edit-&-resend draft state).
		expect(siblingVersions(items, "root", "u1")).toBeNull();
	});

	it("versionsByItem serves every member of a group", () => {
		const map = versionsByItem(branchingTranscript(), "a2");
		expect(map.get("a1")).toEqual({ index: 1, total: 2, ids: ["a1", "a2"] });
		expect(map.get("a2")).toEqual({ index: 1, total: 2, ids: ["a1", "a2"] });
		// tool entries, user entries and singletons get no group
		expect(map.has("r1")).toBe(false);
		expect(map.has("u1")).toBe(false);
	});

	it("does not mix kinds under the same parent", () => {
		const items = [item("root", null, "custom"), item("u1", "root", "user"), item("u2", "root", "user"), item("a1", "root")];
		const map = versionsByItem(items, "a1");
		// a1 has no siblings and the user group is entirely off-path (leaf
		// hangs under root, so u1/u2 are abandoned siblings).
		expect(map.size).toBe(0);
		// Once the new branch is the leaf, the user group shows with the
		// on-path sibling highlighted.
		items.push(item("a2", "u2"));
		const map2 = versionsByItem(items, "a2");
		// Both members carry the group's current index (u2 is on the path).
		expect(map2.get("u1")).toEqual({ index: 1, total: 2, ids: ["u1", "u2"] });
		expect(map2.get("u2")).toEqual({ index: 1, total: 2, ids: ["u1", "u2"] });
		expect(map2.has("a1")).toBe(false);
		expect(map2.has("a2")).toBe(false);
	});
});

describe("leafPathIds", () => {
	it("walks to the root and includes the leaf", () => {
		expect(leafPathIds(branchingTranscript(), "r1")).toEqual(
			new Set(["r1", "ts1", "a1", "u1", "root"]),
		);
	});
});
