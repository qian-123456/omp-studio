// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposer } from "../../stores/composer";
import { AnnotationMarkers } from "./AnnotationMarkers";

vi.mock("../../stores/live", () => ({
	useLive: { getState: () => ({ scrollToItem: () => {} }) },
}));

/** Text x-position inside the nested scroller; moves when it scrolls. */
let textLeft = 200;

beforeEach(() => {
	textLeft = 200;
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		() => new DOMRect(0, 0, 1000, 500),
	);
	const rect = () => new DOMRect(textLeft, 100, 80, 20);
	if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
	vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(rect);
	Range.prototype.getClientRects = () => [rect()] as unknown as DOMRectList;
	useComposer.setState({
		annotations: {
			s1: [{ id: "a", source: "message", itemId: "m1", text: "needle text" }],
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	useComposer.setState({ annotations: {} });
});

describe("AnnotationMarkers nested scrolling", () => {
	it("follows quoted text when a code block inside the stream scrolls horizontally", async () => {
		const ref = createRef<HTMLDivElement>();
		const { container } = render(
			<div ref={ref}>
				<div id="msg-m1">
					<pre style={{ overflowX: "auto" }}>
						<code>some needle text here</code>
					</pre>
				</div>
				<AnnotationMarkers sessionId="s1" containerRef={ref} />
			</div>,
		);
		const badge = () => container.querySelector<HTMLButtonElement>("button[aria-label]");
		await waitFor(() => expect(badge()).not.toBeNull());
		const before = badge()!.style.left;

		textLeft = 120;
		// Dispatched outside act(): the badge must already be repositioned in the
		// same event turn, a trailing badge reads as damping.
		container.querySelector("pre")!.dispatchEvent(new Event("scroll"));
		expect(badge()!.style.left).not.toBe(before);
	});
});
