// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaTextView } from "./IdeaEditor";

let heights = { scroll: 40, client: 40 };
let roCallbacks: Array<() => void> = [];

beforeEach(() => {
	heights = { scroll: 40, client: 40 };
	roCallbacks = [];
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(cb: () => void) {
				roCallbacks.push(cb);
			}
			observe() {}
			disconnect() {}
		},
	);
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => heights.scroll });
	Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => heights.client });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("IdeaTextView truncation", () => {
	it("shows no expand toggle when the text fits", () => {
		render(<IdeaTextView stored="short" refImages={[]} />);
		expect(screen.queryByText("展开全文")).toBeNull();
	});

	it("shows the toggle when the text overflows the clamp", () => {
		heights = { scroll: 80, client: 40 };
		render(<IdeaTextView stored="long" refImages={[]} />);
		expect(screen.getByText("展开全文")).toBeTruthy();
	});

	it("re-measures on resize: toggle appears when re-wrapping overflows, and disappears when it fits again", () => {
		render(<IdeaTextView stored="resizable" refImages={[]} />);
		expect(screen.queryByText("展开全文")).toBeNull();
		heights = { scroll: 80, client: 40 };
		act(() => roCallbacks.forEach((cb) => cb()));
		expect(screen.getByText("展开全文")).toBeTruthy();
		heights = { scroll: 40, client: 40 };
		act(() => roCallbacks.forEach((cb) => cb()));
		expect(screen.queryByText("展开全文")).toBeNull();
	});
});
