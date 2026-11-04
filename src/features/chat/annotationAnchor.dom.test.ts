// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { collectTextSegments, locateQuote, quoteOccurrence, segmentOffset, segmentRange } from "./annotationAnchor";

afterEach(() => document.body.replaceChildren());

function resolveSelection(root: Element, start: Text, quote: string) {
	const { text, segments } = collectTextSegments(root);
	const offset = segmentOffset(segments, start, 0)!;
	const occurrence = quoteOccurrence(text, quote, offset);
	const hit = locateQuote(text, quote, occurrence)!;
	return segmentRange(segments, hit.start, hit.end)!;
}

describe("annotation DOM occurrence anchors", () => {
	it("keeps a selected table row instead of the same words in a later paragraph", () => {
		document.body.innerHTML = "<article><table><tbody><tr><td>ollama 模型</td><td>4.6G</td></tr></tbody></table><p>ollama 模型 4.6G</p></article>";
		const root = document.querySelector("article")!;
		const cells = root.querySelectorAll("td");
		const range = resolveSelection(root, cells[0].firstChild as Text, "ollama 模型\t4.6G");
		expect(range.startContainer).toBe(cells[0].firstChild);
		expect(range.endContainer).toBe(cells[1].firstChild);
		expect(range.endOffset).toBe(4);
	});

	it("keeps the later paragraph when the table has identical visible words", () => {
		document.body.innerHTML = "<article><table><tbody><tr><td>ollama 模型</td><td>4.6G</td></tr></tbody></table><p>ollama 模型 4.6G</p></article>";
		const root = document.querySelector("article")!;
		const paragraph = root.querySelector("p")!;
		const range = resolveSelection(root, paragraph.firstChild as Text, "ollama 模型 4.6G");
		expect(range.startContainer).toBe(paragraph.firstChild);
		expect(range.toString()).toBe("ollama 模型 4.6G");
	});

	it("does not introduce spaces inside inline formatting", () => {
		document.body.innerHTML = "<p>hel<strong>lo</strong> world</p>";
		const root = document.querySelector("p")!;
		const range = resolveSelection(root, root.firstChild as Text, "hello world");
		expect(range.toString()).toBe("hello world");
	});

	it("covers text on both sides of an explicit line break", () => {
		document.body.innerHTML = "<p>alpha<br>beta</p>";
		const root = document.querySelector("p")!;
		const range = resolveSelection(root, root.firstChild as Text, "alpha\nbeta");
		expect(range.startContainer).toBe(root.firstChild);
		expect(range.endContainer).toBe(root.lastChild);
		expect(range.endOffset).toBe(4);
	});
});
