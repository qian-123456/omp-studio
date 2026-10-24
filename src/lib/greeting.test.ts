import { describe, expect, it } from "vitest";
import { greetingKeyFor } from "./greeting";

describe("greetingKeyFor", () => {
	it("switches slot exactly on the 5/12/18/23 o'clock boundaries", () => {
		const g = greetingKeyFor;
		const slots = (hours: number[]) => new Set(hours.map((h) => g(h))).size;
		expect(g(4)).toBe(g(23));
		expect(g(5)).toBe(g(11));
		expect(g(11)).not.toBe(g(12));
		expect(g(12)).toBe(g(17));
		expect(g(17)).not.toBe(g(18));
		expect(g(18)).toBe(g(22));
		expect(g(22)).not.toBe(g(23));
		expect(g(0)).toBe(g(4));
		expect(slots([...Array(24).keys()])).toBe(4);
	});
});
