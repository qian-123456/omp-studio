import { describe, expect, it } from "vitest";
import { SessionHoverCard } from "./SessionHoverCard";

describe("SessionHoverCard Component (Superset workspace preview card)", () => {
	it("is exported as a React component function", () => {
		expect(typeof SessionHoverCard).toBe("function");
	});
});
