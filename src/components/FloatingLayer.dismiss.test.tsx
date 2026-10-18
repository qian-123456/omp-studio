// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** A confirm-style dialog portaled after the popover, like `confirmDialog` does. */
function mountModalAbove(onEscape: () => void): HTMLElement {
	const modal = document.createElement("div");
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	modal.tabIndex = -1;
	modal.addEventListener("keydown", (e) => {
		if (e.key === "Escape") onEscape();
	});
	document.body.appendChild(modal);
	return modal;
}

describe("FloatingLayer dismissal with a modal stacked above", () => {
	it("lets the modal own Escape and clicks, then dismisses again once the modal is gone", () => {
		const onDismiss = vi.fn();
		render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} layer="popover" onDismiss={onDismiss}>
				<span>popover</span>
			</FloatingLayer>,
		);
		const onModalEscape = vi.fn();
		const modal = mountModalAbove(onModalEscape);

		fireEvent.keyDown(modal, { key: "Escape" });
		fireEvent.mouseDown(modal);
		expect(onModalEscape).toHaveBeenCalledTimes(1);
		expect(onDismiss).not.toHaveBeenCalled();

		modal.remove();
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("a modal FloatingLayer still closes on Escape when it is the topmost modal", () => {
		const onDismiss = vi.fn();
		render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} placement="center" layer="modal" onDismiss={onDismiss}>
				<span>dialog</span>
			</FloatingLayer>,
		);
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
