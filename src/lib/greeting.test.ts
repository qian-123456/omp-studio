import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor", () => {
	it("switches slot exactly on the 5/12/18/23 o'clock boundaries", () => {
		const slots = (hours: number[]) => new Set(hours.map(greetingFor)).size;
		expect(greetingFor(4)).toBe(greetingFor(23));
		expect(greetingFor(5)).toBe(greetingFor(11));
		expect(greetingFor(11)).not.toBe(greetingFor(12));
		expect(greetingFor(12)).toBe(greetingFor(17));
		expect(greetingFor(17)).not.toBe(greetingFor(18));
		expect(greetingFor(18)).toBe(greetingFor(22));
		expect(greetingFor(22)).not.toBe(greetingFor(23));
		expect(greetingFor(0)).toBe(greetingFor(4));
		expect(slots([...Array(24).keys()])).toBe(4);
	});
});
