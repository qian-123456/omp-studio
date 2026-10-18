import { describe, expect, it } from "vitest";
import { restartNeedsConfirm, restartState } from "./sessionRestart";

const live = { live: true, archived: false, status: "idle", file: "/a.jsonl" } as const;

describe("restartState", () => {
	it("restarts live sessions", () => {
		expect(restartState(live)).toEqual({ kind: "live" });
	});
	it("wakes suspended or process-less sessions", () => {
		expect(restartState({ ...live, live: false })).toEqual({ kind: "wake" });
		expect(restartState({ ...live, status: "suspended" })).toEqual({ kind: "wake" });
	});
	it("disables archived, external and file-less sessions with a reason", () => {
		for (const s of [
			{ ...live, archived: true },
			{ ...live, status: "external" as const },
			{ ...live, file: "" },
		]) {
			const r = restartState(s);
			expect(r.kind).toBe("disabled");
			if (r.kind === "disabled") expect(r.reason.length).toBeGreaterThan(0);
		}
	});
});

describe("restartNeedsConfirm", () => {
	it("confirms only while a turn or dialog is in flight", () => {
		expect(restartNeedsConfirm({ status: "working" })).toBe(true);
		expect(restartNeedsConfirm({ status: "awaiting_approval" })).toBe(true);
		expect(restartNeedsConfirm({ status: "idle" })).toBe(false);
	});
});
