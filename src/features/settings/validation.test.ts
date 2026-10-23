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
			mobileIpv6Enabled: true,
			mobileIpv6Port: 7789,
			ddnsEnabled: true,
			ddnsZoneId: "023e105f4ecef8ad9ca31a8372d0c353",
			ddnsHostname: "home.example.com",
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
			expect(res.value.mobileIpv6Enabled).toBe(true);
			expect(res.value.mobileIpv6Port).toBe(7789);
			expect(res.value.ddnsEnabled).toBe(true);
			expect(res.value.ddnsZoneId).toBe("023e105f4ecef8ad9ca31a8372d0c353");
			expect(res.value.ddnsHostname).toBe("home.example.com");
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
		expect(validateSettingsShape({ idleSuspendMinutes: -1 }).ok).toBe(false);
	});

	it("validates ompCheckIntervalHours boundaries", () => {
		for (const v of [1, 720, 24]) {
			expect(validateSettingsShape({ ompCheckIntervalHours: v })).toEqual({
				ok: true,
				value: { ompCheckIntervalHours: v },
			});
		}
		for (const v of [0, 721, 1.5, "24", null]) {
			expect(validateSettingsShape({ ompCheckIntervalHours: v })).toEqual({
				ok: false,
				error: "omp 自动检查间隔必须是 1 到 720 小时之间的整数",
			});
		}
	});

	it("rejects flag injections and control characters in strings", () => {
		expect(validateSettingsShape({ newSessionModel: "-flag" }).ok).toBe(false);
		expect(validateSettingsShape({ sideChatModel: "-flag" }).ok).toBe(false);
		expect(validateSettingsShape({ sideChatModel: "m\0x" }).ok).toBe(false);
		expect(validateSettingsShape({ sideChatModel: 42 }).ok).toBe(false);
		expect(validateSettingsShape({ sideChatModel: null }).ok).toBe(true);
		expect(validateSettingsShape({ sideChatModel: "anthropic/x:high" }).ok).toBe(true);
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

	it("validates sendShortcut and followUpBehavior enums", () => {
		expect(validateSettingsShape({ sendShortcut: "enter" })).toEqual({
			ok: true,
			value: { sendShortcut: "enter" },
		});
		expect(validateSettingsShape({ sendShortcut: "mod-enter" })).toEqual({
			ok: true,
			value: { sendShortcut: "mod-enter" },
		});
		expect(validateSettingsShape({ sendShortcut: "ctrl-enter" }).ok).toBe(false);
		expect(validateSettingsShape({ sendShortcut: null }).ok).toBe(false);
		for (const v of ["steer", "queue", "interrupt"]) {
			expect(validateSettingsShape({ followUpBehavior: v })).toEqual({
				ok: true,
				value: { followUpBehavior: v },
			});
		}
		expect(validateSettingsShape({ followUpBehavior: "append" }).ok).toBe(false);
		expect(validateSettingsShape({ followUpBehavior: 1 }).ok).toBe(false);
	});

	it("validates mobileIpv6Port boundaries and rejects invalid port", () => {
		expect(validateSettingsShape({ mobileIpv6Port: 0 }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Port: 70000 }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Port: -1 }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Port: 1.5 }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Port: "7789" }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Port: 7789 }).ok).toBe(true);
		expect(validateSettingsShape({ mobileIpv6Port: 1 }).ok).toBe(true);
		expect(validateSettingsShape({ mobileIpv6Port: 65535 }).ok).toBe(true);
	});

	it("validates mobileIpv6Enabled and ddnsEnabled booleans", () => {
		expect(validateSettingsShape({ mobileIpv6Enabled: "true" }).ok).toBe(false);
		expect(validateSettingsShape({ ddnsEnabled: 1 }).ok).toBe(false);
		expect(validateSettingsShape({ mobileIpv6Enabled: false }).ok).toBe(true);
		expect(validateSettingsShape({ ddnsEnabled: true }).ok).toBe(true);
	});

	it("validates ddnsZoneId and ddnsHostname string or null", () => {
		expect(validateSettingsShape({ ddnsHostname: null }).ok).toBe(true);
		expect(validateSettingsShape({ ddnsZoneId: null }).ok).toBe(true);
		expect(validateSettingsShape({ ddnsHostname: "home.example.com" }).ok).toBe(true);
		expect(validateSettingsShape({ ddnsZoneId: "zone-123" }).ok).toBe(true);
		expect(validateSettingsShape({ ddnsHostname: 12345 }).ok).toBe(false);
		expect(validateSettingsShape({ ddnsZoneId: 12345 }).ok).toBe(false);
		expect(validateSettingsShape({ ddnsHostname: "bad\nhost" }).ok).toBe(false);
		expect(validateSettingsShape({ ddnsZoneId: "bad\0zone" }).ok).toBe(false);
	});
});
