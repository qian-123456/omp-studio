// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadProviderWindows, setProviderWindow } from "./core";

afterEach(() => localStorage.clear());

describe("provider context defaults", () => {
	it("persists exact provider identities independently, including providers with no models", () => {
		setProviderWindow("provider-a", 64000);
		setProviderWindow("provider-b", 128000);
		expect(loadProviderWindows()).toEqual({ "provider-a": 64000, "provider-b": 128000 });
		setProviderWindow("provider-a", null);
		expect(loadProviderWindows()).toEqual({ "provider-b": 128000 });
	});
	it("does not load malformed, nonpositive or fractional values", () => {
		localStorage.setItem("ompws.providerContextWindows.v1", JSON.stringify({ a: 0, b: -1, c: 1.5, d: "128000", e: 32000 }));
		expect(loadProviderWindows()).toEqual({ e: 32000 });
	});
});
