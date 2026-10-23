// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyText = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("../lib/dialogs", () => ({
	copyText,
	errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("../lib/toast", () => ({ toast: { error: toastError } }));

import { CopyButton } from "./CopyButton";

beforeEach(() => {
	vi.useFakeTimers();
	copyText.mockReset();
	toastError.mockReset();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("CopyButton", () => {
	it("copies, shows the copied state, then resets", async () => {
		copyText.mockResolvedValue(undefined);
		render(<CopyButton text="hello" label="复制" copiedLabel="已复制" title="复制命令" />);
		const btn = screen.getByRole("button");
		expect(btn.getAttribute("aria-label")).toBe("复制命令");
		await act(async () => {
			fireEvent.click(btn);
		});
		expect(copyText).toHaveBeenCalledWith("hello");
		expect(btn.getAttribute("aria-label")).toBe("已复制");
		expect(btn.textContent).toBe("已复制");
		act(() => {
			vi.advanceTimersByTime(1500);
		});
		expect(btn.getAttribute("aria-label")).toBe("复制命令");
		expect(btn.textContent).toBe("复制");
	});

	it("evaluates a text function at click time", async () => {
		copyText.mockResolvedValue(undefined);
		let live = "a";
		render(<CopyButton text={() => live} />);
		live = "b";
		await act(async () => {
			fireEvent.click(screen.getByRole("button"));
		});
		expect(copyText).toHaveBeenCalledWith("b");
	});

	it("toasts and stays idle when copying fails", async () => {
		copyText.mockRejectedValue(new Error("denied"));
		render(<CopyButton text="x" />);
		const btn = screen.getByRole("button");
		await act(async () => {
			fireEvent.click(btn);
		});
		expect(toastError).toHaveBeenCalledWith("复制失败: denied");
		expect(btn.getAttribute("aria-label")).toBe("复制");
	});
});
