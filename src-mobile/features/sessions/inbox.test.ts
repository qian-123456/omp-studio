import { describe, expect, it } from "vitest";
import { inboxCount } from "./inbox";
import type { Todo } from "./todos";
import type { TreeSession } from "./tree";

const s = (id: string) => ({ id }) as TreeSession;
const todo = (id: string, sessionId: string | null, status = "open"): Todo => ({ id, kind: "approval", status, sessionId, title: id });

describe("inboxCount", () => {
	it("counts distinct actionable sessions, ignores running, and adds only todos of other sessions", () => {
		const data = { awaiting: [s("a")], error: [s("b")], unread: [s("a"), s("c")], running: [s("r")] };
		const todos = [todo("t1", "a"), todo("t2", "x"), todo("t3", null), todo("t4", "y", "done")];
		expect(inboxCount(data, todos)).toBe(3 + 2);
	});

	it("works before the inbox is loaded", () => {
		expect(inboxCount(null, [todo("t1", "a")])).toBe(1);
	});
});
