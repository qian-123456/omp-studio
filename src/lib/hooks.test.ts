// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isComposing, resetLastCompositionEndForTest } from "./hooks";

const fire = (el: Element, type: string, init: Record<string, unknown> = {}) => {
	const ev = new Event(type, { bubbles: true });
	Object.assign(ev, init);
	el.dispatchEvent(ev);
};

describe("isComposing stale-state recovery", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		resetLastCompositionEndForTest();
	});

	it("is true during a composition and false after compositionend", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		expect(isComposing({ key: "a" })).toBe(true);
		fire(el, "compositionend");
		expect(isComposing({ key: "a" })).toBe(false);
	});

	it("recovers when the composing element is removed without compositionend", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		el.remove();
		expect(isComposing({ key: "a" })).toBe(false);
	});

	it("recovers when focus leaves the composing element without compositionend", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "focusout");
		expect(isComposing({ key: "a" })).toBe(false);
	});

	it("recovers on a real (non-IME) keydown after an orphaned composition", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "keydown", { isComposing: false, keyCode: 13 });
		expect(isComposing({ key: "a" })).toBe(false);
	});

	it("stays composing on IME keydown (keyCode 229)", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "keydown", { isComposing: false, keyCode: 229 });
		expect(isComposing({ key: "Enter" })).toBe(true);
		fire(el, "compositionend");
	});

	it("rapid Enter after Space-committed composition is not swallowed as composing", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "compositionend");
		// Space committed the candidate: fires keydown for Space
		fire(el, "keydown", { key: " ", isComposing: false, keyCode: 32 });
		// Immediate rapid Enter within 60ms must be treated as a send keystroke, not composing
		const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
		el.dispatchEvent(enter);
		expect(isComposing({ nativeEvent: enter, key: "Enter" })).toBe(false);
	});

	it("committing Enter is seen by every reader without consuming state; next Enter sends", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "compositionend");
		// Trailing commit Enter from WebKit (isComposing false): shortcut dispatcher + composer both read it
		const commit = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
		el.dispatchEvent(commit);
		expect(isComposing({ nativeEvent: commit, key: "Enter" })).toBe(true);
		expect(isComposing({ nativeEvent: commit, key: "Enter" })).toBe(true);
		expect(isComposing({ nativeEvent: commit, key: "Enter" })).toBe(true);
		// A distinct subsequent Enter is a deliberate send
		const next = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
		el.dispatchEvent(next);
		expect(isComposing({ nativeEvent: next, key: "Enter" })).toBe(false);
	});

	it("a window-level reader runs before bubbling handlers and sees the committing Enter", () => {
		const el = document.body.appendChild(document.createElement("div"));
		fire(el, "compositionstart");
		fire(el, "compositionend");
		const seen: boolean[] = [];
		const onKey = (ev: Event) => seen.push(isComposing({ nativeEvent: ev, key: "Enter" }));
		window.addEventListener("keydown", onKey, true);
		el.addEventListener("keydown", onKey);
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		window.removeEventListener("keydown", onKey, true);
		expect(seen).toEqual([true, true]);
	});
});
