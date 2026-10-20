// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_START_DELAY_MS, useAnswerStarted } from "./useAnswerStarted";

describe("useAnswerStarted", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const run = (candidate: boolean, settled: boolean) =>
		renderHook(({ c, s }) => useAnswerStarted(c, s), {
			initialProps: { c: candidate, s: settled },
		});

	it("latches only after the candidate has trailed for the debounce delay", () => {
		const { result } = run(true, false);
		expect(result.current).toBe(false);
		act(() => vi.advanceTimersByTime(ANSWER_START_DELAY_MS - 1));
		expect(result.current).toBe(false);
		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe(true);
	});

	it("never latches for prose that a tool call follows quickly", () => {
		const { result, rerender } = run(true, false);
		act(() => vi.advanceTimersByTime(ANSWER_START_DELAY_MS - 100));
		rerender({ c: false, s: false });
		act(() => vi.advanceTimersByTime(ANSWER_START_DELAY_MS * 2));
		expect(result.current).toBe(false);
	});

	it("drops again when a later step proves the text was interim", () => {
		const { result, rerender } = run(true, false);
		act(() => vi.advanceTimersByTime(ANSWER_START_DELAY_MS));
		expect(result.current).toBe(true);
		rerender({ c: false, s: false });
		expect(result.current).toBe(false);
	});

	it("reads as started immediately once the stream has settled", () => {
		const { result } = run(true, true);
		expect(result.current).toBe(true);
		const none = run(false, true);
		expect(none.result.current).toBe(false);
	});
});
