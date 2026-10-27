import { describe, expect, it } from "vitest";
import { branchChoice } from "./search";
import { todoChoices } from "./todos";

describe("todoChoices", () => {
	it("uses the request's own options and marks approvals primary", () => {
		const c = todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", options: ["Allow once", { id: "d", label: "拒绝" }] } } });
		expect(c).toEqual([
			{ id: "Allow once", label: "Allow once", primary: false },
			{ id: "d", label: "拒绝", primary: false },
		]);
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", choices: ["Approve"] } } })?.[0].primary).toBe(true);
	});

	it("a bare confirm offers 批准 / 拒绝; free-text requests and session-less todos offer none", () => {
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", method: "confirm" } } })?.map((x) => x.label)).toEqual(["批准", "拒绝"]);
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", method: "input" } } })).toBeNull();
		expect(todoChoices({ sessionId: null, payload: { uiRequest: { id: "r" } } })).toBeNull();
		expect(todoChoices({ sessionId: "s", payload: null })).toBeNull();
	});
});

describe("branchChoice", () => {
	it("opens a single hit directly and asks to choose among several, noting truncation", () => {
		expect(branchChoice({ branch: "main", count: 1, sessionIds: ["a"] })).toEqual({ kind: "open", id: "a" });
		expect(branchChoice({ branch: "main", count: 9, sessionIds: ["a", "b"] })).toEqual({
			kind: "choose",
			title: "main（共 9 个，列出 2 个）",
			ids: ["a", "b"],
		});
		expect(branchChoice({ branch: "dev", count: 2, sessionIds: ["a", "b"] })).toMatchObject({ title: "dev" });
	});
});
