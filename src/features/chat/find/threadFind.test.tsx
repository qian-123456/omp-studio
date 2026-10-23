// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../../lib/contracts";
import { isEscapeClaimed } from "../../../lib/escapeClaim";
import { useUi } from "../../../stores/ui";
import { computeMatches, stepIndex } from "./findCore";
import { openThreadFind } from "./openThreadFind";
import { ThreadFindBar } from "./ThreadFindBar";
import { useThreadFind } from "./threadFindStore";

const item = (id: string, kind: "user" | "assistant", text: string | null, hidden = false) =>
	({ id, kind, text, hidden }) as TranscriptItem;

afterEach(() => {
	cleanup();
	useThreadFind.getState().close();
	useUi.setState({ centerView: "home", selectedSessionId: null, sessionViewMode: {} });
});

describe("computeMatches", () => {
	it("is case-insensitive and counts several hits per item", () => {
		const m = computeMatches([item("a", "user", "Foo foo FOO"), item("b", "assistant", "xfoo")], "foo");
		expect(m.map((x) => `${x.itemId}:${x.occurrence}`)).toEqual(["a:0", "a:1", "a:2", "b:0"]);
	});
	it("matches CJK, ignores empty query, hidden and non-message items", () => {
		expect(computeMatches([item("a", "user", "你好世界你好")], "你好")).toHaveLength(2);
		expect(computeMatches([item("a", "user", "x")], "")).toEqual([]);
		expect(computeMatches([item("a", "user", "x", true), item("b", "assistant", null)], "x")).toEqual([]);
		expect(computeMatches([item("a", "user", "abc")], "zzz")).toEqual([]);
	});
});

describe("stepIndex", () => {
	it("wraps at both ends and handles empty", () => {
		expect(stepIndex(2, 3, 1)).toBe(0);
		expect(stepIndex(0, 3, -1)).toBe(2);
		expect(stepIndex(-1, 3, 1)).toBe(0);
		expect(stepIndex(-1, 0, 1)).toBe(-1);
	});
});

describe("openThreadFind", () => {
	it("returns false without a visible chat", () => {
		expect(openThreadFind()).toBe(false);
		useUi.setState({ centerView: "session", selectedSessionId: "s1", sessionViewMode: { s1: "terminal" } });
		expect(openThreadFind()).toBe(false);
		useUi.setState({ centerView: "settings" });
		expect(openThreadFind()).toBe(false);
		expect(useThreadFind.getState().open).toBe(false);
	});
	it("opens for a visible chat, and closing resets state", () => {
		useUi.setState({ centerView: "session", selectedSessionId: "s1", sessionViewMode: {} });
		expect(openThreadFind()).toBe(true);
		useThreadFind.getState().setQuery("x");
		expect(useThreadFind.getState()).toMatchObject({ open: true, sessionId: "s1" });
		useThreadFind.getState().close();
		expect(useThreadFind.getState()).toMatchObject({ open: false, query: "", index: -1 });
	});
});

describe("ThreadFindBar", () => {
	it("claims Esc, closes and returns focus to the composer", () => {
		render(
			<div>
				<textarea data-composer="s1" />
				<ThreadFindBar sessionId="s1" />
			</div>,
		);
		act(() => useThreadFind.getState().show("s1"));
		const input = screen.getByLabelText("在对话中查找");
		const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		act(() => {
			input.dispatchEvent(ev);
		});
		expect(isEscapeClaimed(ev)).toBe(true);
		expect(useThreadFind.getState().open).toBe(false);
		expect(document.activeElement).toBe(document.querySelector("textarea"));
	});
	it("does not step on Enter while composing", () => {
		render(<ThreadFindBar sessionId="s1" />);
		act(() => useThreadFind.getState().show("s1", "a"));
		const input = screen.getByLabelText("在对话中查找");
		fireEvent.compositionStart(input);
		const before = useThreadFind.getState().navNonce;
		fireEvent.keyDown(input, { key: "Enter" });
		expect(useThreadFind.getState().navNonce).toBe(before);
	});
});
