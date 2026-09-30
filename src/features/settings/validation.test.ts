import { describe, expect, it } from "vitest";
import { validateSettingsShape } from "./validation";

describe("validateSettingsShape", () => {
	it("rejects non-objects, null, and arrays", () => {
		expect(validateSettingsShape(null).ok).toBe(false);
		expect(validateSettingsShape("string").ok).toBe(false);
		expect(validateSettingsShape(123).ok).toBe(false);
		expect(validateSettingsShape([]).ok).toBe(false);
	});

	it("accepts valid partial settings", () => {
		const res = validateSettingsShape({
			systemDetection: true,
			defaultApprovalMode: "yolo",
			mobilePort: 8080,
			supervisorIntervalMinutes: 30,
			idleSuspendMinutes: 60,
			notifyQuietFrom: "22:00",
			notifyQuietTo: "08:00",
			turnCheckpoints: false,
		});
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.value.systemDetection).toBe(true);
			expect(res.value.defaultApprovalMode).toBe("yolo");
			expect(res.value.mobilePort).toBe(8080);
			expect(res.value.notifyQuietFrom).toBe("22:00");
			expect(res.value.notifyQuietTo).toBe("08:00");
		}
	});

	it("rejects invalid approval mode or tunnel mode", () => {
		expect(validateSettingsShape({ defaultApprovalMode: "danger" }).ok).toBe(false);
		expect(validateSettingsShape({ tunnelMode: "custom" }).ok).toBe(false);
	});

	it("rejects out of range numbers", () => {
		expect(validateSettingsShape({ mobilePort: 0 }).ok).toBe(false);
		expect(validateSettingsShape({ mobilePort: 70000 }).ok).toBe(false);
		expect(validateSettingsShape({ supervisorIntervalMinutes: 10081 }).ok).toBe(false);
		expect(validateSettingsShape({ idleSuspendMinutes: -1 }).ok).toBe(false);
	});

	it("rejects flag injections and control characters in strings", () => {
		expect(validateSettingsShape({ newSessionModel: "-flag" }).ok).toBe(false);
		expect(validateSettingsShape({ tunnelName: "--injection" }).ok).toBe(false);
		expect(validateSettingsShape({ ompBinary: "omp\0bad" }).ok).toBe(false);
		expect(validateSettingsShape({ ompBinary: "" }).ok).toBe(false);
	});

	it("validates quiet hours paired format", () => {
		expect(
			validateSettingsShape({ notifyQuietFrom: "22:00", notifyQuietTo: null }).ok,
		).toBe(false);
		expect(
			validateSettingsShape({ notifyQuietFrom: "25:00", notifyQuietTo: "08:00" }).ok,
		).toBe(false);
		expect(
			validateSettingsShape({ notifyQuietFrom: "8:00", notifyQuietTo: "08:00" }).ok,
		).toBe(false);
	});
});
