// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RangeHighlightOverlay } from "./rangeHighlightGeometry";

class ResizeObserverStub {
    observe() {}
    disconnect() {}
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("RangeHighlightOverlay ownership", () => {
    it("removes one saved range without clearing the other owner", async () => {
        const root = document.createElement("div");
        const text = document.createElement("span");
        text.textContent = "selected text";
        const reactHost = document.createElement("div");
        root.append(text, reactHost);
        document.body.append(root);
        const rootRef = { current: root };
        const range = document.createRange();
        range.selectNodeContents(text);
        const previousRects = Range.prototype.getClientRects;
        Range.prototype.getClientRects = () => [new DOMRect(10, 10, 40, 16)] as unknown as DOMRectList;
        try {
            const { rerender } = render(
                <>
                    <RangeHighlightOverlay rootRef={rootRef} ranges={[range]} tone="saved" />
                    <RangeHighlightOverlay rootRef={rootRef} ranges={[range]} tone="saved" />
                </>,
                { container: reactHost },
            );
            expect(root.isConnected).toBe(true);
            await waitFor(() => expect(root.querySelectorAll("[aria-hidden]")).toHaveLength(2));
            rerender(<RangeHighlightOverlay rootRef={rootRef} ranges={[range]} tone="saved" />);
            await waitFor(() => expect(root.querySelectorAll("[aria-hidden] span")).toHaveLength(1));
        } finally {
            Range.prototype.getClientRects = previousRects;
            root.remove();
        }
    });
});
