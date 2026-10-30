// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FloatingLayer } from "./FloatingLayer";

// jsdom lacks ResizeObserver, which FloatingLayer uses for positioning.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

/** Placement belongs to the primitive: a caller's skin must not be able to drop a
 *  layer into normal flow, where `left`/`top` become offsets from the page bottom
 *  and the dialog lands outside the window (the quick-capture "opens nothing" bug). */
describe("FloatingLayer placement is immune to caller position classes", () => {
	it("stays fixed when the caller passes a conflicting position utility", () => {
		render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} placement="center" layer="modal" className="relative mt-6">
				<span>dialog</span>
			</FloatingLayer>,
		);
		const el = document.querySelector<HTMLElement>('[data-layer="modal"]')!;
		expect(getComputedStyle(el).position).toBe("fixed");
	});

	it("pins the measured placement inline so no class can override it", () => {
		render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} placement="center" layer="modal" className="absolute">
				<span>dialog</span>
			</FloatingLayer>,
		);
		const el = document.querySelector<HTMLElement>('[data-layer="modal"]')!;
		expect(el.style.position).toBe("fixed");
		expect(el.style.zIndex).toBe("400");
	});
});
