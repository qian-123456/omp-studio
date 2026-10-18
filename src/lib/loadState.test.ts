import { describe, expect, it } from "vitest";
import { deriveLoadState } from "./loadState";

describe("deriveLoadState", () => {
	it("is loading until the first load settles", () => {
		expect(deriveLoadState(false, null)).toBe("loading");
	});
	it("is error when the first load failed", () => {
		expect(deriveLoadState(false, "boom")).toBe("error");
	});
	it("keeps showing data once loaded, even if a refresh error is recorded", () => {
		expect(deriveLoadState(true, null)).toBe("ready");
		expect(deriveLoadState(true, "boom")).toBe("ready");
	});
});
