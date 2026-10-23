import { beforeEach, describe, expect, it } from "vitest";
import { currentLocateId, locateLabel, stepLocateIndex, useLocate } from "./locate";

beforeEach(() => useLocate.getState().clear());

describe("locate helpers", () => {
	it("labels with a 1-based position", () => {
		expect(locateLabel("web_search", 2)).toBe("已定位：web_search #3");
	});

	it("clamps stepping to the group bounds", () => {
		expect(stepLocateIndex(0, 3, -1)).toBe(0);
		expect(stepLocateIndex(0, 3, 1)).toBe(1);
		expect(stepLocateIndex(2, 3, 1)).toBe(2);
		expect(stepLocateIndex(0, 0, 1)).toBe(0);
	});

	it("resolves the current call id", () => {
		expect(currentLocateId(null)).toBeNull();
		expect(currentLocateId({ callIds: ["a", "b"], index: 1 })).toBe("b");
		expect(currentLocateId({ callIds: ["a"], index: 5 })).toBeNull();
	});
});

describe("useLocate", () => {
	it("ignores an empty group and clamps the start index", () => {
		useLocate.getState().locate("s", "bash", []);
		expect(useLocate.getState().target).toBeNull();
		useLocate.getState().locate("s", "bash", ["a", "b"], 9);
		expect(useLocate.getState().target?.index).toBe(1);
	});

	it("steps through the group and bumps nonce only when moving", () => {
		const s = useLocate.getState();
		s.locate("s", "web_search", ["a", "b", "c"]);
		const first = useLocate.getState().target;
		expect(currentLocateId(first)).toBe("a");
		useLocate.getState().step(-1);
		expect(useLocate.getState().target?.nonce).toBe(first?.nonce);
		useLocate.getState().step(1);
		const second = useLocate.getState().target;
		expect(currentLocateId(second)).toBe("b");
		expect(second?.nonce).not.toBe(first?.nonce);
		useLocate.getState().clear();
		expect(useLocate.getState().target).toBeNull();
	});

	it("re-locating the same call re-fires with a new nonce", () => {
		useLocate.getState().locate("s", "x", ["a"]);
		const n1 = useLocate.getState().target?.nonce;
		useLocate.getState().locate("s", "x", ["a"]);
		expect(useLocate.getState().target?.nonce).not.toBe(n1);
	});
});
