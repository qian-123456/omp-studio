// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findQuoteRange, quoteAnswerPartHint, setQuoteOccurrenceHint } from "./annotationLocate";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("findQuoteRange", () => {
	it("covers exactly the quoted text, even across inline elements", () => {
		document.body.innerHTML = '<div id="msg-m1"><p>alpha beta <b>gamma</b> delta</p></div>';
		const range = findQuoteRange("m1", "beta gamma");
		expect(range?.toString()).toBe("beta gamma");
	});

	it("returns null when the message is not rendered or the quote is absent", () => {
		document.body.innerHTML = '<div id="msg-m1">hello</div>';
		expect(findQuoteRange("missing", "hello")).toBeNull();
		expect(findQuoteRange("m1", "goodbye")).toBeNull();
	});

	it("keeps repeated matches local to the selected slice when other slices unmount", () => {
		document.body.innerHTML = '<div id="msg-answer">repeat</div><div id="msg-answer-answer-part-2"><p>repeat</p><p>repeat</p></div>';
		setQuoteOccurrenceHint("answer", "repeat", 1, 2);
		expect(quoteAnswerPartHint("answer", "repeat")).toBe(2);
		document.getElementById("msg-answer")!.remove();
		const target = document.getElementById("msg-answer-answer-part-2")!.lastChild!.firstChild;
		expect(findQuoteRange("answer", "repeat")?.startContainer).toBe(target);
	});

	it("waits for the requested slice instead of flashing an identical earlier quote", () => {
		document.body.innerHTML = '<div id="msg-answer">repeat</div>';
		setQuoteOccurrenceHint("answer", "repeat", undefined, 3);
		expect(findQuoteRange("answer", "repeat")).toBeNull();
		expect(quoteAnswerPartHint("answer", "repeat")).toBe(3);
		const part = document.createElement("div");
		part.id = "msg-answer-answer-part-3";
		part.textContent = "repeat";
		document.body.append(part);
		expect(findQuoteRange("answer", "repeat")?.startContainer).toBe(part.firstChild);
	});
});
