// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEditableTarget, resolveApprovalChoices } from "./approvalOptions";

// Label set produced by omp's tool-approval prompt (DPe): grant labels,
// "Always …" labels, once, optional session, Deny.
const FILE_OPTIONS = [
	"Approve Directory: src/annotations",
	"Approve File",
	"Always Approve Directory: src/annotations",
	"Always Approve File",
	"Approve Once",
	"Approve bash for this session",
	"Deny",
];

describe("resolveApprovalChoices", () => {
	it("maps once/session/always/deny to distinct exact omp labels", () => {
		const c = resolveApprovalChoices(FILE_OPTIONS);
		expect(c).toEqual({
			once: "Approve Once",
			session: "Approve bash for this session",
			always: "Always Approve File",
			deny: "Deny",
		});
		expect(new Set(Object.values(c)).size).toBe(4);
	});

	it("deny never picks an Approve option, even when a label contains 'no'", () => {
		const c = resolveApprovalChoices([
			"Approve Directory: src/annotations",
			"Approve",
			"Deny",
		]);
		expect(c.deny).toBe("Deny");
		expect(resolveApprovalChoices(["Approve Directory: src/annotations", "Approve"]).deny).toBeUndefined();
	});

	it("plain prompts map once to 'Approve' and leave unavailable choices undefined", () => {
		expect(resolveApprovalChoices(["Approve", "Deny"])).toEqual({
			once: "Approve",
			session: undefined,
			always: undefined,
			deny: "Deny",
		});
	});

	it("falls back to a directory 'always' grant only when nothing narrower exists", () => {
		const c = resolveApprovalChoices([
			"Approve Directory: d",
			"Always Approve Directory: d",
			"Approve Once",
			"Deny",
		]);
		expect(c.always).toBe("Always Approve Directory: d");
		expect(c.once).toBe("Approve Once");
	});
});

describe("isEditableTarget", () => {
	it("recognises text inputs but not buttons", () => {
		expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
		expect(isEditableTarget(document.createElement("input"))).toBe(true);
		expect(isEditableTarget(document.createElement("button"))).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});
});
