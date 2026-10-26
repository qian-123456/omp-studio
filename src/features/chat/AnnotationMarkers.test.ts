import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../stores/composer";
import { markerSources } from "./AnnotationMarkers";

// AnnotationMarkers only touches useLive inside the marker onClick; the store
// itself pulls in Tauri event plumbing that node cannot load.
vi.mock("../../stores/live", () => ({
	useLive: { getState: () => ({ scrollToItem: () => {} }) },
}));

const msg = (id: string, text: string, comment?: string): Annotation => ({
	id,
	source: "message",
	itemId: `item-${id}`,
	text,
	comment,
});

describe("markerSources", () => {
	it("numbers main and side-chat annotations as separate lists", () => {
		const sources = markerSources(
			[msg("m1", "first quote"), msg("m2", "second quote")],
			[msg("s1", "side quote")],
		);
		expect(sources.map((s) => [s.kind, s.n])).toEqual([
			["main", 1],
			["main", 2],
			["sidechat", 1],
		]);
		expect(sources[0].title).toBe("批注 1：first quote");
		expect(sources[2].title).toBe("辅助对话批注 1：side quote");
	});

	it("renumbers each list after a move between them", () => {
		// Moving main annotation m2 to the side-chat list drops it there with a
		// new id; the remaining main marker renumbers and the side list counts up.
		const sources = markerSources(
			[msg("m1", "first quote")],
			[msg("s1", "side quote"), { ...msg("m2", "second quote"), id: "ann-moved" }],
		);
		expect(sources.map((s) => [s.id, s.kind, s.n])).toEqual([
			["m1", "main", 1],
			["s1", "sidechat", 1],
			["ann-moved", "sidechat", 2],
		]);
	});

	it("skips annotations with no message anchor", () => {
		const diff: Annotation = {
			id: "d1",
			source: "diff",
			file: "a.ts",
			lines: "1-2",
			text: "hunk",
		};
		expect(markerSources([diff, msg("m1", "q")], [])).toHaveLength(1);
	});
});
