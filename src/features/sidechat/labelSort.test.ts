import { describe, expect, it } from "vitest";
import { compareSessionLabels } from "./labelSort";

describe("compareSessionLabels", () => {
	it("sorts #1.10 after #1.2", () => {
		const list = ["#1.10", "#1.2", "#1.1", "#1.20", "#1.9"];
		list.sort(compareSessionLabels);
		expect(list).toEqual(["#1.1", "#1.2", "#1.9", "#1.10", "#1.20"]);
	});

	it("sorts nested dot-separated numbers", () => {
		const list = ["#1.2.10", "#1.2.2", "#1.2", "#1.10.1", "#1.2.1"];
		list.sort(compareSessionLabels);
		expect(list).toEqual(["#1.2", "#1.2.1", "#1.2.2", "#1.2.10", "#1.10.1"]);
	});

	it("handles non-numeric or mixed labels gracefully", () => {
		const list = ["#b", "#a", "#1.2", "#1.1"];
		list.sort(compareSessionLabels);
		expect(list).toEqual(["#1.1", "#1.2", "#a", "#b"]);
	});

	it("handles identical labels", () => {
		expect(compareSessionLabels("#1.2", "#1.2")).toBe(0);
	});
});
