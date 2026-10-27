import { describe, expect, it } from "vitest";
import { buildPendingResponse, doneOption, isApprovalRequest, nextMultiChoice, otherOption, pendingForm } from "./pendingUi";

const entry = (request: Record<string, unknown>, sessionId = "s1") => ({ sessionId, request, receivedAt: "" });

const askLoop = entry({
	id: "q1",
	method: "select",
	title: "(1 selected) Pick tools (2/3)",
	options: ["Read (Recommended)", "Write", "Bash", "Other (type your own)", "Finish Done selecting"],
	optionDetails: [{ description: "reads files" }],
});

describe("pendingForm", () => {
	it("reads a confirm request with the owning session", () => {
		const f = pendingForm(entry({ id: "p1", method: "confirm", title: "Continue?", message: "ok?" }));
		expect(f).toMatchObject({ id: "p1", method: "confirm", title: "Continue?", message: "ok?", sessionId: "s1", multiple: false, text: false });
	});

	it("strips multi-select title decorations", () => {
		const f = pendingForm(askLoop);
		expect(f.title).toBe("Pick tools");
		expect(f.selectedCount).toBe(1);
		expect(f.index).toBe(2);
		expect(f.total).toBe(3);
		expect(f.multiple).toBe(true);
	});

	it("classifies option rows", () => {
		const o = pendingForm(askLoop).options;
		expect(o[0]).toMatchObject({ label: "Read", recommended: true, description: "reads files" });
		expect(o[1]).toMatchObject({ label: "Write", raw: "Write", recommended: false, isDone: false });
		expect(o[3].isOther).toBe(true);
		expect(o[4]).toMatchObject({ isDone: true, label: "Finish", recommended: false });
	});

	it("marks a required text prompt from copy hints, but not when allowEmpty", () => {
		expect(pendingForm(entry({ id: "a", method: "input", title: "Name (required)" })).required).toBe(true);
		expect(pendingForm(entry({ id: "a", method: "input", title: "名称 必填", allowEmpty: true })).required).toBe(false);
		expect(pendingForm(entry({ id: "a", method: "editor", title: "plain" })).text).toBe(true);
	});

	it("accepts a bare request and a fallback session id", () => {
		expect(pendingForm({ id: "x", method: "confirm" }, "cur").sessionId).toBe("cur");
	});
});

describe("buildPendingResponse", () => {
	it("builds select/confirm/cancel bodies", () => {
		expect(buildPendingResponse(askLoop, { value: "Write" })).toEqual({ id: "q1", value: "Write" });
		expect(buildPendingResponse({ id: "c", method: "confirm" }, { confirmed: false })).toEqual({ id: "c", confirmed: false });
		expect(buildPendingResponse({ id: "c", method: "input" }, { cancelled: true })).toEqual({ id: "c", cancelled: true });
		expect(buildPendingResponse({ id: "c", method: "confirm" }, { confirmed: true, always: true, persist: true })).toEqual({
			id: "c",
			confirmed: true,
			always: true,
			persist: true,
		});
	});

	it("refuses an empty answer to a required prompt and a missing id / answer", () => {
		const req = { id: "r", method: "input", title: "Name (required)" };
		expect(() => buildPendingResponse(req, { text: "  " })).toThrow("该问题必填");
		expect(() => buildPendingResponse({ method: "confirm" }, { confirmed: true })).toThrow("缺少 id");
		expect(() => buildPendingResponse({ id: "r", method: "input" }, {})).toThrow();
	});

	it("falls back to the request default for an empty optional text", () => {
		expect(buildPendingResponse({ id: "d", method: "input", default: "dflt" }, { text: "" })).toEqual({ id: "d", value: "dflt" });
		// A required prompt with default still rejects an empty box (desktop parity)
		expect(() => buildPendingResponse({ id: "d", method: "input", title: "required", default: "x" }, { text: "" })).toThrow();
	});
});

describe("multi-select loop", () => {
	it("flips exactly one raw option per call and tracks toggles", () => {
		const first = nextMultiChoice(askLoop, ["Read", "Bash"], []);
		expect(first).toEqual({ value: "Read (Recommended)", toggled: ["Read"] });
		const second = nextMultiChoice(askLoop, ["Read", "Bash"], first!.toggled);
		expect(second).toEqual({ value: "Bash", toggled: ["Read", "Bash"] });
		expect(nextMultiChoice(askLoop, ["Read", "Bash"], second!.toggled)).toBeNull();
	});

	it("flips back a deselected label", () => {
		expect(nextMultiChoice(askLoop, [], ["Write"])).toEqual({ value: "Write", toggled: [] });
	});

	it("never offers the Done/Other rows as a choice and exposes them separately", () => {
		expect(nextMultiChoice(askLoop, ["Finish"], [])).toBeNull();
		expect(doneOption(askLoop)).toBe("Finish Done selecting");
		expect(otherOption(askLoop)).toBe("Other (type your own)");
		expect(doneOption({ id: "c", method: "confirm" })).toBeNull();
	});
});

describe("isApprovalRequest", () => {
	it("is true only for confirm requests, never for ask questions", () => {
		expect(isApprovalRequest({ id: "c", method: "confirm" })).toBe(true);
		expect(isApprovalRequest(askLoop)).toBe(false);
	});
});
