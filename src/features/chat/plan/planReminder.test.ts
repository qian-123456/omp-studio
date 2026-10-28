import { describe, expect, it } from "vitest";
import { endedByAbort, shouldRemind } from "../../../../extension/omp-workspace-plan";

const asst = (stopReason: string) => ({ role: "assistant", stopReason });

describe("plan reminder", () => {
	it("skips the reminder after a user abort", () => {
		expect(shouldRemind(false, 0, [asst("aborted")])).toBe(false);
	});
	it("reminds on a normal end without a plan file", () => {
		expect(shouldRemind(false, 0, [asst("stop")])).toBe(true);
	});
	it("does not remind when reminders are spent or a plan exists", () => {
		expect(shouldRemind(false, 1, [asst("stop")])).toBe(false);
		expect(shouldRemind(true, 0, [asst("stop")])).toBe(false);
	});
	it("ignores non-assistant tail messages and missing lists", () => {
		expect(endedByAbort([asst("aborted"), { role: "toolResult" }])).toBe(true);
		expect(endedByAbort([asst("stop"), { role: "user" }])).toBe(false);
		expect(endedByAbort(undefined)).toBe(false);
		expect(shouldRemind(false, 0, undefined)).toBe(true);
	});
});
