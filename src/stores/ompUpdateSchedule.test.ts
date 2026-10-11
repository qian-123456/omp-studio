import { describe, expect, it } from "vitest";
import { isCheckDue } from "./ompUpdateSchedule";

const HOUR = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

describe("isCheckDue", () => {
	it("is due when there is no previous check", () => {
		expect(isCheckDue(null, 24, T0)).toBe(true);
	});

	it("is not due just under the interval", () => {
		expect(isCheckDue(T0, 24, T0 + 24 * HOUR - 1)).toBe(false);
	});

	it("is due exactly at the interval", () => {
		expect(isCheckDue(T0, 24, T0 + 24 * HOUR)).toBe(true);
	});

	it("honours a custom 1-hour interval", () => {
		expect(isCheckDue(T0, 1, T0 + 59 * 60 * 1000)).toBe(false);
		expect(isCheckDue(T0, 1, T0 + 60 * 60 * 1000)).toBe(true);
	});

	it("is due when the clock moved backwards", () => {
		expect(isCheckDue(T0, 24, T0 - 1)).toBe(true);
	});
});
