import { describe, expect, it } from "vitest";
import { accumulateTail } from "./transcript";

const it_ = (id: string) => ({ id, kind: "assistant" });

describe("accumulateTail", () => {
	it("appends new items, skips duplicates and advances the cursor", () => {
		const a = accumulateTail({ items: [], nextByte: 0 }, { items: [it_("1"), it_("2")], nextByte: 100 });
		const b = accumulateTail(a, { items: [it_("2"), it_("3")], nextByte: 180 });
		expect(b.items.map((i) => i.id)).toEqual(["1", "2", "3"]);
		expect(b.nextByte).toBe(180);
	});
	it("replaces everything on reset", () => {
		const a = accumulateTail({ items: [it_("1")], nextByte: 100 }, { items: [it_("9")], nextByte: 40, reset: true });
		expect(a).toEqual({ items: [it_("9")], nextByte: 40 });
	});
	it("keeps the same array when nothing is new", () => {
		const prev = { items: [it_("1")], nextByte: 5 };
		expect(accumulateTail(prev, { items: [], nextByte: 5 }).items).toBe(prev.items);
	});
});
