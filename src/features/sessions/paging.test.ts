import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { needsAttention } from "./grouping";
import { visibleCut } from "./paging";

const make = (id: string, over: Partial<SessionMeta> = {}): SessionMeta =>
	({ id, status: "idle", unread: false, ...over }) as SessionMeta;

const sessions = (n: number) => Array.from({ length: n }, (_, i) => make(`s${i}`));

describe("visibleCut", () => {
	it("returns the user count when nothing below the cut needs showing", () => {
		expect(visibleCut(sessions(10), 3, null, needsAttention)).toBe(3);
	});

	it("pulls the cut past the selected row, revealing everything above it", () => {
		const list = sessions(10);
		expect(visibleCut(list, 3, "s6", needsAttention)).toBe(7);
	});

	it("pulls the cut past a live row below the cut", () => {
		const list = sessions(10).map((s, i) =>
			i === 8 ? make(s.id, { status: "working" }) : s,
		);
		expect(visibleCut(list, 3, null, needsAttention)).toBe(9);
	});

	it("uses the lowest forced row when several qualify", () => {
		const list = sessions(10).map((s, i) =>
			i === 4 || i === 8 ? make(s.id, { status: "awaiting_approval" }) : s,
		);
		expect(visibleCut(list, 3, "s1", needsAttention)).toBe(9);
	});

	it("never shrinks below the user's own count", () => {
		expect(visibleCut(sessions(10), 6, "s2", needsAttention)).toBe(6);
	});

	it("clamps to the list length", () => {
		expect(visibleCut(sessions(4), 10, null, needsAttention)).toBe(4);
	});
});
