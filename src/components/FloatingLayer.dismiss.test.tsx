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

describe("FloatingLayer Escape handling for editors and IME", () => {
	it("ignores Escape while an IME composition is active", () => {
		const onDismiss = vi.fn();
		render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} onDismiss={onDismiss}>
				<textarea aria-label="note" />
			</FloatingLayer>,
		);
		const ta = document.querySelector("textarea")!;
		fireEvent.keyDown(ta, { key: "Escape", isComposing: true });
		expect(onDismiss).not.toHaveBeenCalled();
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("defers Escape inside a text field only when opted in", () => {
		const onDismiss = vi.fn();
		const { rerender } = render(
			<FloatingLayer anchor={{ x: 10, y: 10 }} onDismiss={onDismiss} deferEscapeToEditors>
				<textarea aria-label="note" />
			</FloatingLayer>,
		);
		const ta = document.querySelector("textarea")!;
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(onDismiss).not.toHaveBeenCalled();
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalledTimes(1);
		rerender(
			<FloatingLayer anchor={{ x: 10, y: 10 }} onDismiss={onDismiss}>
				<textarea aria-label="note" />
			</FloatingLayer>,
		);
		fireEvent.keyDown(document.querySelector("textarea")!, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalledTimes(2);
	});
});
