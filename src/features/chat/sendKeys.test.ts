import { describe, expect, it } from "vitest";
import {
	type EnterKeyEvent,
	alternateShortcutHint,
	decideEnterKey,
	normalizeFollowUpBehavior,
	normalizeSendShortcut,
	resolveFollowUpAction,
} from "./sendKeys";

const enter = (over: Partial<EnterKeyEvent> = {}): EnterKeyEvent => ({
	key: "Enter",
	shiftKey: false,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	isComposing: false,
	...over,
});

describe("decideEnterKey: enter mode", () => {
	const mode = "enter" as const;
	it("plain Enter sends", () => {
		expect(decideEnterKey(enter(), mode)).toBe("send");
	});
	it("Shift+Enter is a newline", () => {
		expect(decideEnterKey(enter({ shiftKey: true }), mode)).toBe("newline");
	});
	it("⌘/Ctrl+Enter sends", () => {
		expect(decideEnterKey(enter({ metaKey: true }), mode)).toBe("send");
		expect(decideEnterKey(enter({ ctrlKey: true }), mode)).toBe("send");
	});
	it("⌥+Enter sends the alternate follow-up", () => {
		expect(decideEnterKey(enter({ altKey: true }), mode)).toBe("send-alternate");
	});
	it("⌘+⌥+Enter sends the alternate follow-up", () => {
		expect(decideEnterKey(enter({ metaKey: true, altKey: true }), mode)).toBe(
			"send-alternate",
		);
	});
	it("Shift+⌥+Enter stays a newline", () => {
		expect(decideEnterKey(enter({ shiftKey: true, altKey: true }), mode)).toBe("newline");
	});
});

describe("decideEnterKey: mod-enter mode", () => {
	const mode = "mod-enter" as const;
	it("plain Enter and Shift+Enter are newlines", () => {
		expect(decideEnterKey(enter(), mode)).toBe("newline");
		expect(decideEnterKey(enter({ shiftKey: true }), mode)).toBe("newline");
	});
	it("⌘/Ctrl+Enter sends", () => {
		expect(decideEnterKey(enter({ metaKey: true }), mode)).toBe("send");
		expect(decideEnterKey(enter({ ctrlKey: true }), mode)).toBe("send");
	});
	it("⌥+⌘/Ctrl+Enter sends the alternate follow-up", () => {
		expect(decideEnterKey(enter({ metaKey: true, altKey: true }), mode)).toBe(
			"send-alternate",
		);
		expect(decideEnterKey(enter({ ctrlKey: true, altKey: true }), mode)).toBe(
			"send-alternate",
		);
	});
	it("⌥+Enter without ⌘/Ctrl is a newline", () => {
		expect(decideEnterKey(enter({ altKey: true }), mode)).toBe("newline");
	});
});

describe("decideEnterKey: ignores", () => {
	it("IME composition never sends, in either mode", () => {
		for (const mode of ["enter", "mod-enter"] as const) {
			expect(decideEnterKey(enter({ isComposing: true }), mode)).toBe("ignore");
			expect(decideEnterKey(enter({ isComposing: true, metaKey: true }), mode)).toBe(
				"ignore",
			);
		}
	});
	it("non-Enter keys are ignored", () => {
		expect(decideEnterKey(enter({ key: "a" }), "enter")).toBe("ignore");
		expect(decideEnterKey(enter({ key: "a", metaKey: true }), "mod-enter")).toBe("ignore");
	});
});

describe("decideEnterKey: rapid/duplicate repeat Enter", () => {
	it("plain Enter with repeat does not fire duplicate sends in enter mode", () => {
		expect(decideEnterKey(enter({ repeat: true }), "enter")).toBe("ignore");
		expect(decideEnterKey(enter({ repeat: true, altKey: true }), "enter")).toBe("ignore");
		expect(decideEnterKey(enter({ repeat: true, metaKey: true }), "enter")).toBe("ignore");
	});

	it("Shift+Enter with repeat remains a newline in enter mode", () => {
		expect(decideEnterKey(enter({ repeat: true, shiftKey: true }), "enter")).toBe("newline");
	});

	it("⌘/Ctrl+Enter with repeat does not fire duplicate sends in mod-enter mode", () => {
		expect(decideEnterKey(enter({ repeat: true, metaKey: true }), "mod-enter")).toBe("ignore");
		expect(decideEnterKey(enter({ repeat: true, ctrlKey: true }), "mod-enter")).toBe("ignore");
	});

	it("plain Enter and Shift+Enter with repeat remain newlines in mod-enter mode", () => {
		expect(decideEnterKey(enter({ repeat: true }), "mod-enter")).toBe("newline");
		expect(decideEnterKey(enter({ repeat: true, shiftKey: true }), "mod-enter")).toBe("newline");
	});
});

describe("resolveFollowUpAction", () => {
	it("not streaming: every send is a plain send, alternate or not", () => {
		for (const behavior of ["steer", "queue", "interrupt"] as const) {
			expect(resolveFollowUpAction(behavior, false, false)).toBe("send");
			expect(resolveFollowUpAction(behavior, true, false)).toBe("send");
		}
	});
	it("streaming, default (non-alternate) send follows the behavior", () => {
		expect(resolveFollowUpAction("steer", false, true)).toBe("steer");
		expect(resolveFollowUpAction("queue", false, true)).toBe("queue");
		expect(resolveFollowUpAction("interrupt", false, true)).toBe("interrupt");
	});
	it("streaming, alternate swaps steer↔queue and maps interrupt→queue", () => {
		expect(resolveFollowUpAction("steer", true, true)).toBe("queue");
		expect(resolveFollowUpAction("queue", true, true)).toBe("steer");
		expect(resolveFollowUpAction("interrupt", true, true)).toBe("queue");
	});
});

describe("settings normalization", () => {
	it("falls back to the defaults for missing or unknown values", () => {
		expect(normalizeSendShortcut(undefined)).toBe("enter");
		expect(normalizeSendShortcut("bogus")).toBe("enter");
		expect(normalizeSendShortcut("mod-enter")).toBe("mod-enter");
		expect(normalizeFollowUpBehavior(undefined)).toBe("steer");
		expect(normalizeFollowUpBehavior("bogus")).toBe("steer");
		expect(normalizeFollowUpBehavior("queue")).toBe("queue");
		expect(normalizeFollowUpBehavior("interrupt")).toBe("interrupt");
	});
});

describe("alternateShortcutHint", () => {
	it("names the alternate chord for each mode", () => {
		expect(alternateShortcutHint("enter")).toBe("⌥Enter");
		expect(alternateShortcutHint("mod-enter")).toBe("⌥⌘Enter");
	});
});
