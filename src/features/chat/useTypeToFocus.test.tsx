// @vitest-environment jsdom
import { render, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { useTypeToFocus } from "./useTypeToFocus";

function Harness({ compact, id }: { compact?: boolean; id: string }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useTypeToFocus(ref, compact);
	return (
		<div data-session-view="" data-testid={`view-${id}`}>
			<div data-testid={`stream-${id}`} tabIndex={-1}>
				stream
			</div>
			<textarea data-testid={`ta-${id}`} ref={ref} defaultValue="draft" />
		</div>
	);
}

afterEach(cleanup);

describe("useTypeToFocus", () => {
	it("focuses the composer when a printable key is typed on the body", () => {
		const { getByTestId } = render(<Harness id="a" />);
		fireEvent.keyDown(document.body, { key: "h" });
		expect(document.activeElement).toBe(getByTestId("ta-a"));
		expect((document.activeElement as HTMLTextAreaElement).selectionStart).toBe(5);
	});

	it("routes keys with no focus target to the view last clicked or scrolled in", () => {
		const { getByTestId } = render(
			<>
				<Harness id="main" />
				<Harness id="side" compact />
			</>,
		);
		fireEvent.wheel(getByTestId("stream-side"));
		fireEvent.keyDown(document.body, { key: "h" });
		expect(document.activeElement).toBe(getByTestId("ta-side"));
		(document.activeElement as HTMLElement).blur();
		fireEvent.pointerDown(document.body);
		fireEvent.keyDown(document.body, { key: "h" });
		expect(document.activeElement).toBe(getByTestId("ta-main"));
	});

	it("ignores shortcuts, space, navigation keys and prevented events", () => {
		const { getByTestId } = render(<Harness id="a" />);
		fireEvent.keyDown(document.body, { key: "c", metaKey: true });
		fireEvent.keyDown(document.body, { key: " " });
		fireEvent.keyDown(document.body, { key: "ArrowDown" });
		const prevented = new KeyboardEvent("keydown", { key: "y", bubbles: true, cancelable: true });
		window.addEventListener("keydown", (e) => e.preventDefault(), { capture: true, once: true });
		document.body.dispatchEvent(prevented);
		expect(document.activeElement).not.toBe(getByTestId("ta-a"));
	});

	it("treats Cmd+V as a paste into the composer", () => {
		const { getByTestId } = render(<Harness id="a" />);
		fireEvent.keyDown(document.body, { key: "v", metaKey: true });
		expect(document.activeElement).toBe(getByTestId("ta-a"));
	});

	it("leaves other editable fields and open modals alone", () => {
		const { getByTestId } = render(
			<>
				<Harness id="a" />
				<input data-testid="other" />
			</>,
		);
		const other = getByTestId("other");
		other.focus();
		fireEvent.keyDown(other, { key: "x" });
		expect(document.activeElement).toBe(other);

		const modal = document.createElement("div");
		modal.setAttribute("aria-modal", "true");
		document.body.appendChild(modal);
		fireEvent.keyDown(document.body, { key: "x" });
		expect(document.activeElement).not.toBe(getByTestId("ta-a"));
		modal.remove();
	});

	it("routes keys typed in a view to that view's composer, others to the main one", () => {
		const { getByTestId } = render(
			<>
				<Harness id="main" />
				<Harness id="side" compact />
			</>,
		);
		fireEvent.keyDown(getByTestId("stream-side"), { key: "q" });
		expect(document.activeElement).toBe(getByTestId("ta-side"));

		(document.activeElement as HTMLElement).blur();
		fireEvent.keyDown(getByTestId("stream-main"), { key: "q" });
		expect(document.activeElement).toBe(getByTestId("ta-main"));

		(document.activeElement as HTMLElement).blur();
		fireEvent.keyDown(document.body, { key: "q" });
		expect(document.activeElement).toBe(getByTestId("ta-main"));
	});

	it("does not redirect keys while an ideas-style popover is open, even if its field blurred", () => {
		const { getByTestId } = render(<Harness id="a" />);
		const pop = document.createElement("div");
		pop.setAttribute("data-layer", "popover");
		const idea = document.createElement("textarea");
		pop.append(idea);
		document.body.append(pop);
		idea.focus();
		fireEvent.keyDown(idea, { key: "h" });
		expect(document.activeElement).toBe(idea);
		idea.blur();
		fireEvent.keyDown(document.body, { key: "h" });
		expect(document.activeElement).not.toBe(getByTestId("ta-a"));
		pop.remove();
	});
});

describe("useTypeToFocus with an active IME", () => {
	it("moves focus but swallows the first plain key", async () => {
		const { setImeActiveForTest } = await import("../../lib/imeState");
		setImeActiveForTest(true);
		try {
			const { getByTestId } = render(<Harness id="a" />);
			const e = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
			document.body.dispatchEvent(e);
			expect(document.activeElement).toBe(getByTestId("ta-a"));
			expect(e.defaultPrevented).toBe(true);
			// Paste is not IME input: it still goes through.
			(document.activeElement as HTMLElement).blur();
			const paste = new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true, cancelable: true });
			document.body.dispatchEvent(paste);
			expect(paste.defaultPrevented).toBe(false);
		} finally {
			setImeActiveForTest(false);
		}
	});

	it("leaves the key alone without an IME", () => {
		const { getByTestId } = render(<Harness id="a" />);
		const e = new KeyboardEvent("keydown", { key: "w", bubbles: true, cancelable: true });
		document.body.dispatchEvent(e);
		expect(document.activeElement).toBe(getByTestId("ta-a"));
		expect(e.defaultPrevented).toBe(false);
	});
});
