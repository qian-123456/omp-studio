import { describe, expect, it } from "vitest";
import { resolveActiveSessionTarget } from "./activeSessionTarget";

describe("active session target", () => {
	const drafts = { draft: { opts: { cwd: "/project-b", workspaceId: "b" }, sessionId: null } };
	const sessions = { session: { cwd: "/project-a", workspaceId: "a" } };
	it("prefers the selected draft to the previous session", () => {
		expect(resolveActiveSessionTarget({ selectedSessionId: "session", selectedDraftId: "draft", drafts, sessions }))
			.toEqual({ source: "draft", sessionId: null, cwd: "/project-b", workspaceId: "b" });
	});
	it("uses the selected session and never substitutes a previous one", () => {
		expect(resolveActiveSessionTarget({ selectedSessionId: "session", selectedDraftId: null, drafts, sessions }).cwd).toBe("/project-a");
		expect(resolveActiveSessionTarget({ selectedSessionId: null, selectedDraftId: null, drafts, sessions }).source).toBe("none");
	});
});
