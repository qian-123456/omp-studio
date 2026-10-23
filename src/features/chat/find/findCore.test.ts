// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../../lib/contracts";
import {
	collectRanges,
	computeMatches,
	resolveAnchor,
	visibleFindItems,
} from "./findCore";
import { useThreadFind } from "./threadFindStore";

const item = (id: string, kind: "user" | "assistant", text: string | null, hidden = false) =>
	({ id, kind, text, hidden }) as TranscriptItem;

afterEach(() => {
	useThreadFind.getState().close();
	document.body.innerHTML = "";
});

describe("visibleFindItems", () => {
	it("hides a side chat's inherited parent history", () => {
		const items = [
			item("p1", "user", "parent question"),
			item("p2", "assistant", "parent answer"),
			item(
				"s1",
				"user",
				"Side chat forked from main session\n\n## User question\n\n为什么？",
			),
			item("s2", "assistant", "因为……"),
		];
		const visible = visibleFindItems(items, true);
		expect(visible.map((i) => i.id)).toEqual(["s1", "s2"]);
		// The template text is replaced by the user's own question.
		expect(computeMatches(visible, "parent")).toEqual([]);
		expect(computeMatches(visible, "为什么")).toHaveLength(1);
	});

	it("keeps ordinary sessions untouched and never mutates the input", () => {
		const items = [item("a", "user", "hello"), item("b", "assistant", "hi")];
		const visible = visibleFindItems(items, false);
		expect(visible).toEqual(items);
		expect(items[0].text).toBe("hello");
	});
});

describe("resolveAnchor", () => {
	it("finds the rendered anchor for turn steps and plain rows", () => {
		const root = document.createElement("div");
		root.innerHTML = [
			'<div id="msg-steer-u1"><span>steer text</span></div>',
			'<div id="msg-text-a1"><span>interim text</span></div>',
			'<div id="msg-u2"><span>user</span></div>',
			'<div id="msg-live-answer"></div>',
		].join("");
		document.body.append(root);
		expect(resolveAnchor(root, "u1")?.id).toBe("msg-steer-u1");
		expect(resolveAnchor(root, "a1")?.id).toBe("msg-text-a1");
		expect(resolveAnchor(root, "u2")?.id).toBe("msg-u2");
		expect(resolveAnchor(root, "missing")).toBeNull();
	});

	it("collects ranges inside the mapped anchor only", () => {
		const root = document.createElement("div");
		root.innerHTML = [
			'<div id="msg-steer-u1">foo one</div>',
			'<div id="msg-u2">foo two</div>',
		].join("");
		document.body.append(root);
		const host = resolveAnchor(root, "u1");
		expect(host).not.toBeNull();
		const ranges = collectRanges(host as Element, "foo");
		expect(ranges).toHaveLength(1);
		expect(ranges[0].startContainer.parentElement?.id).toBe("msg-steer-u1");
	});
});

describe("thread find navigation across query changes", () => {
	it("re-fires navigation when the current hit moves, even at the same index", () => {
		const st = useThreadFind.getState();
		st.show("s1");
		// Query A hits message A only.
		useThreadFind.getState().setMatches([{ itemId: "A", occurrence: 0 }]);
		const first = useThreadFind.getState();
		expect(first.index).toBe(0);

		// Query B hits message B only: the index stays 0 but the hit is elsewhere,
		// so the highlighter must be told to navigate again.
		useThreadFind.getState().setMatches([{ itemId: "B", occurrence: 0 }]);
		expect(useThreadFind.getState().index).toBe(0);
		expect(useThreadFind.getState().navNonce).toBeGreaterThan(first.navNonce);
	});

	it("does not re-navigate when the same hit is re-applied", () => {
		useThreadFind.getState().show("s1");
		const matches = [{ itemId: "A", occurrence: 0 }];
		useThreadFind.getState().setMatches(matches);
		const nonce = useThreadFind.getState().navNonce;
		useThreadFind.getState().setMatches([{ itemId: "A", occurrence: 0 }]);
		expect(useThreadFind.getState().navNonce).toBe(nonce);
	});

	it("treats a different occurrence of the same item as a new hit", () => {
		useThreadFind.getState().show("s1");
		useThreadFind.getState().setMatches([
			{ itemId: "A", occurrence: 0 },
			{ itemId: "A", occurrence: 1 },
		]);
		const nonce = useThreadFind.getState().navNonce;
		useThreadFind.getState().step(1);
		expect(useThreadFind.getState().navNonce).toBeGreaterThan(nonce);
		expect(useThreadFind.getState().index).toBe(1);
	});
});
