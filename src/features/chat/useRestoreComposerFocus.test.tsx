// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useRestoreComposerFocus } from "./useRestoreComposerFocus";

function Harness({ sid = "s1", compact }: { sid?: string; compact?: boolean }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useRestoreComposerFocus(ref, compact, sid);
	return (
		<div data-session-view="">
			<div data-testid="blank">thread</div>
			<button type="button" data-testid="btn">
				go
			</button>
			<textarea data-testid="ta" ref={ref} defaultValue="draft" />
		</div>
	);
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(60)));
const click = (el: Element) => el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("useRestoreComposerFocus", () => {
	it("focuses the composer on entering a session", async () => {
		const { getByTestId, rerender } = render(<Harness sid="a" />);
		await flush();
		expect(document.activeElement).toBe(getByTestId("ta"));
		(document.activeElement as HTMLElement).blur();
		rerender(<Harness sid="b" />);
		await flush();
		expect(document.activeElement).toBe(getByTestId("ta"));
	});

	it("does not steal focus from another input", async () => {
		const other = document.createElement("input");
		document.body.append(other);
		other.focus();
		const { getByTestId } = render(<Harness />);
		await flush();
		expect(document.activeElement).toBe(other);
		expect(document.activeElement).not.toBe(getByTestId("ta"));
	});

	it("restores focus after a blank click but not after a button click or with a selection", async () => {
		const { getByTestId } = render(<Harness />);
		await flush();
		const ta = getByTestId("ta");
		ta.blur();
		click(getByTestId("btn"));
		await flush();
		expect(document.activeElement).not.toBe(ta);
		const blank = getByTestId("blank");
		const range = document.createRange();
		range.selectNodeContents(blank);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		click(blank);
		await flush();
		expect(document.activeElement).not.toBe(ta);
		window.getSelection()?.removeAllRanges();
		click(blank);
		await flush();
		expect(document.activeElement).toBe(ta);
	});

	it("restores focus once a popover closes", async () => {
		const { getByTestId } = render(<Harness />);
		await flush();
		const ta = getByTestId("ta");
		const pop = document.createElement("div");
		pop.setAttribute("data-layer", "popover");
		document.body.append(pop);
		ta.blur();
		await flush();
		expect(document.activeElement).not.toBe(ta);
		pop.remove();
		await flush();
		expect(document.activeElement).toBe(ta);
	});

	it("does nothing while a popover is still open", async () => {
		const pop = document.createElement("div");
		pop.setAttribute("data-layer", "popover");
		document.body.append(pop);
		const { getByTestId } = render(<Harness />);
		await flush();
		expect(document.activeElement).not.toBe(getByTestId("ta"));
	});

	it("never pulls focus from a portaled popover textarea (ideas capture) on layer churn", async () => {
		const { getByTestId } = render(<Harness />);
		await flush();
		const ta = getByTestId("ta");
		const pop = document.createElement("div");
		pop.setAttribute("data-layer", "popover");
		const idea = document.createElement("textarea");
		pop.append(idea);
		document.body.append(pop);
		idea.focus();
		// A toast mounting/unmounting (streaming state change) triggers the restore path.
		const toast = document.createElement("div");
		toast.setAttribute("data-layer", "toast");
		document.body.append(toast);
		toast.remove();
		await flush();
		expect(document.activeElement).toBe(idea);
		// Transient blur of the idea field while the popover stays open: still no restore.
		idea.blur();
		click(document.body);
		await flush();
		expect(document.activeElement).not.toBe(ta);
	});
});
