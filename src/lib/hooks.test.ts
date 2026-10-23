// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isComposing } from "./hooks";

const fire = (el: Element, type: string, init: Record<string, unknown> = {}) => {
	const ev = new Event(type, { bubbles: true });
	Object.assign(ev, init);
	el.dispatchEvent(ev);
};

describe("isComposing stale-state recovery", () => {
	afterEach(() => {
		document.body.innerHTML = "";
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
});
