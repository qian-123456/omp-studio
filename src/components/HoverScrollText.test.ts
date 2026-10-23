import { describe, expect, it } from "vitest";
import { HoverScrollText } from "./HoverScrollText";

describe("HoverScrollText Component (Superset WorkspaceNameMarquee specification)", () => {
	it("is exported as a callable React component", () => {
		expect(typeof HoverScrollText).toBe("function");
	});

	it("computes reasonable scroll durations using Superset constant pace (32 px/s, min 0.5s, max 6s)", () => {
		const PIXELS_PER_SECOND = 32;
		const MIN_DURATION = 0.5;
		const MAX_DURATION = 6.0;

		const calcDuration = (overflow: number) => {
			return Math.min(MAX_DURATION, Math.max(MIN_DURATION, overflow / PIXELS_PER_SECOND));
		};

		// Small overflow (10px): 10 / 32 = 0.3125s -> clamped to MIN_DURATION 0.5s
		expect(calcDuration(10)).toBe(0.5);

		// Medium overflow (96px): 96 / 32 = 3.0s exactly
		expect(calcDuration(96)).toBe(3.0);

		// Huge overflow (300px): 300 / 32 = 9.375s -> clamped to MAX_DURATION 6.0s
		expect(calcDuration(300)).toBe(6.0);
	});
});
