// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findQuoteRange } from "./annotationLocate";

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
});
