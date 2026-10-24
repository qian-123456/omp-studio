import { tNow } from "../../stores/language";
import type { Settings } from "../../lib/contracts";

const VALID_APPROVAL_MODES: Record<string, true> = {
	"always-ask": true,
	write: true,
	yolo: true,
};

const VALID_TUNNEL_MODES: Record<string, true> = {
	off: true,
	quick: true,
	named: true,
};

export type ValidationResult =
	| { ok: true; value: Partial<Settings> }
	| { ok: false; error: string };

function isValidHhmm(s: string): boolean {
	const parts = s.split(":");
	if (parts.length !== 2) return false;
	const [h, m] = parts;
	if (h.length !== 2 || m.length !== 2) return false;
	const hh = Number(h);
	const mm = Number(m);
	return Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

/**
 * Validates the shape and boundaries of an arbitrary imported JSON object
 * before applying it optimistically to the settings store.
 */
export function validateSettingsShape(input: unknown): ValidationResult {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return { ok: false, error: tNow("settingsCore.validation.jsonExpected") };
	}

	const raw = input as Record<string, unknown>;
	const out: Partial<Settings> = {};

	const boolKeys: (keyof Settings)[] = [
		"systemDetection",
		"smartContextRouting",
		"notifyTurnEnd",
		"notifyApproval",
		"notifyExit",
		"notifySound",
		"capsuleVisible",
		"mobileEnabled",
		"mobileIpv6Enabled",
		"ddnsEnabled",
		"dockBadgeEnabled",
		"sessionTurnAutoRefresh",
		"sessionGroupByWorktree",
		"visualizeEnabled",
	];

	for (const k of boolKeys) {
		if (k in raw) {
			if (typeof raw[k] !== "boolean") {
				return { ok: false, error: tNow("settingsCore.validation.booleanExpected", { key: k }) };
			}
			(out as Record<string, unknown>)[k] = raw[k];
		}
	}

	if ("turnCheckpoints" in raw) {
		if (raw.turnCheckpoints !== null && typeof raw.turnCheckpoints !== "boolean") {
			return { ok: false, error: tNow("settingsCore.validation.booleanOrNullExpected", { key: "turnCheckpoints" }) };
		}
		out.turnCheckpoints = raw.turnCheckpoints as boolean | null;
	}

	if ("queueAutoSend" in raw) {
		if (raw.queueAutoSend !== null && typeof raw.queueAutoSend !== "boolean") {
			return { ok: false, error: tNow("settingsCore.validation.booleanOrNullExpected", { key: "queueAutoSend" }) };
		}
		out.queueAutoSend = raw.queueAutoSend as boolean | null;
	}

	if ("privacyRevealDefault" in raw) {
		if (
			raw.privacyRevealDefault !== null &&
			typeof raw.privacyRevealDefault !== "boolean"
		) {
			return { ok: false, error: tNow("settingsCore.validation.booleanOrNullExpected", { key: "privacyRevealDefault" }) };
		}
		out.privacyRevealDefault = raw.privacyRevealDefault as boolean | null;
	}

	if ("ompAutoUpdate" in raw) {
		if (raw.ompAutoUpdate !== null && typeof raw.ompAutoUpdate !== "boolean") {
			return { ok: false, error: tNow("settingsCore.validation.booleanOrNullExpected", { key: "ompAutoUpdate" }) };
		}
		out.ompAutoUpdate = raw.ompAutoUpdate as boolean | null;
	}

	if ("defaultApprovalMode" in raw) {
		if (
			typeof raw.defaultApprovalMode !== "string" ||
			!VALID_APPROVAL_MODES[raw.defaultApprovalMode]
		) {
			return {
				ok: false,
				error: tNow("settingsCore.validation.unsupportedApprovalMode", { value: String(raw.defaultApprovalMode) }),
			};
		}
		out.defaultApprovalMode = raw.defaultApprovalMode;
	}

	if ("tunnelMode" in raw) {
		if (typeof raw.tunnelMode !== "string" || !VALID_TUNNEL_MODES[raw.tunnelMode]) {
			return {
				ok: false,
				error: tNow("settingsCore.validation.unsupportedTunnelMode", { value: String(raw.tunnelMode) }),
			};
		}
		out.tunnelMode = raw.tunnelMode;
	}

	if ("mobilePort" in raw) {
		const port = raw.mobilePort;
		if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
			return { ok: false, error: tNow("settingsCore.validation.mobilePortRange") };
		}
		out.mobilePort = port;
	}

	if ("mobileIpv6Port" in raw) {
		const port = raw.mobileIpv6Port;
		if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
			return { ok: false, error: tNow("settingsCore.validation.ipv6PortRange") };
		}
		out.mobileIpv6Port = port;
	}

	if ("inboxWindowHours" in raw) {
		const val = raw.inboxWindowHours;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 720) {
			return { ok: false, error: tNow("settingsCore.validation.inboxWindowHoursRange") };
		}
		out.inboxWindowHours = val;
	}

	if ("ompCheckIntervalHours" in raw) {
		const val = raw.ompCheckIntervalHours;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 720) {
			return { ok: false, error: tNow("settingsCore.validation.ompCheckIntervalHoursRange") };
		}
		out.ompCheckIntervalHours = val;
	}

	if ("idleSuspendMinutes" in raw) {
		const val = raw.idleSuspendMinutes;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 1440) {
			return { ok: false, error: tNow("settingsCore.validation.idleSuspendMinutesRange") };
		}
		out.idleSuspendMinutes = val;
	}

	if ("ompBinary" in raw) {
		const val = raw.ompBinary;
		if (typeof val !== "string" || val.trim().length === 0) {
			return { ok: false, error: tNow("settingsCore.validation.ompBinaryRequired") };
		}
		if (/[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.ompBinaryNoNull") };
		}
		out.ompBinary = val;
	}

	if ("quickCaptureShortcut" in raw) {
		const val = raw.quickCaptureShortcut;
		if (typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.shortcutStringRequired") };
		}
		if (/[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.shortcutNoNull") };
		}
		out.quickCaptureShortcut = val;
	}

	if ("tunnelName" in raw) {
		const val = raw.tunnelName;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.tunnelNameStringOrNull") };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: tNow("settingsCore.validation.tunnelNameNoNull") };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: tNow("settingsCore.validation.tunnelNameNoDash") };
			}
		}
		out.tunnelName = val;
	}

	if ("tunnelHostname" in raw) {
		const val = raw.tunnelHostname;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.tunnelHostnameStringOrNull") };
		}
		if (typeof val === "string" && /[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.tunnelHostnameNoNull") };
		}
		out.tunnelHostname = val;
	}

	if ("ddnsZoneId" in raw) {
		const val = raw.ddnsZoneId;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.ddnsZoneIdStringOrNull") };
		}
		if (typeof val === "string" && /[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.ddnsZoneIdNoNull") };
		}
		out.ddnsZoneId = val;
	}

	if ("ddnsHostname" in raw) {
		const val = raw.ddnsHostname;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.ddnsHostnameStringOrNull") };
		}
		if (typeof val === "string" && /[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.ddnsHostnameNoNull") };
		}
		out.ddnsHostname = val;
	}

	if ("newSessionModel" in raw) {
		const val = raw.newSessionModel;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.newSessionModelStringOrNull") };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: tNow("settingsCore.validation.newSessionModelNoNull") };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: tNow("settingsCore.validation.newSessionModelNoDash") };
			}
		}
		out.newSessionModel = val;
	}

	if ("sideChatModel" in raw) {
		const val = raw.sideChatModel;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.sideChatModelStringOrNull") };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: tNow("settingsCore.validation.sideChatModelNoNull") };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: tNow("settingsCore.validation.sideChatModelNoDash") };
			}
		}
		out.sideChatModel = val;
	}

	const hasFrom = "notifyQuietFrom" in raw;
	const hasTo = "notifyQuietTo" in raw;
	if (hasFrom || hasTo) {
		const from = raw.notifyQuietFrom;
		const to = raw.notifyQuietTo;
		if (from !== null && typeof from !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.quietFromFormat") };
		}
		if (to !== null && typeof to !== "string") {
			return { ok: false, error: tNow("settingsCore.validation.quietToFormat") };
		}
		if ((from === null && to !== null) || (from !== null && to === null)) {
			return { ok: false, error: tNow("settingsCore.validation.quietBothRequired") };
		}
		if (typeof from === "string" && !isValidHhmm(from)) {
			return { ok: false, error: tNow("settingsCore.validation.quietFromInvalid", { from }) };
		}
		if (typeof to === "string" && !isValidHhmm(to)) {
			return { ok: false, error: tNow("settingsCore.validation.quietToInvalid", { to }) };
		}
		out.notifyQuietFrom = from;
		out.notifyQuietTo = to;
	}

	if ("gitDeliveryMode" in raw) {
		const val = raw.gitDeliveryMode;
		if (val !== "pr" && val !== "direct" && val !== null && val !== undefined) {
			return { ok: false, error: tNow("settingsCore.validation.gitDeliveryModeInvalid") };
		}
		if (typeof val === "string") {
			out.gitDeliveryMode = val;
		}
	}

	if ("doctorModel" in raw) {
		const val = raw.doctorModel;
		if (typeof val !== "string" || /[\0\r\n]/.test(val)) {
			return { ok: false, error: tNow("settingsCore.validation.doctorModelInvalid") };
		}
		out.doctorModel = val;
	}

	if ("doctorAutoMode" in raw) {
		const val = raw.doctorAutoMode;
		if (val !== "manual" && val !== "idle" && val !== "scheduled") {
			return { ok: false, error: tNow("settingsCore.validation.doctorAutoModeInvalid") };
		}
		out.doctorAutoMode = val;
	}

	if ("doctorIdleMinutes" in raw) {
		const val = raw.doctorIdleMinutes;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 10080) {
			return { ok: false, error: tNow("settingsCore.validation.doctorIdleMinutesRange") };
		}
		out.doctorIdleMinutes = val;
	}

	if ("doctorScheduleTime" in raw) {
		const val = raw.doctorScheduleTime;
		if (typeof val !== "string" || !isValidHhmm(val)) {
			return { ok: false, error: tNow("settingsCore.validation.doctorScheduleTimeInvalid") };
		}
		out.doctorScheduleTime = val;
	}

	if ("sendShortcut" in raw) {
		const val = raw.sendShortcut;
		if (val !== "enter" && val !== "mod-enter") {
			return { ok: false, error: tNow("settingsCore.validation.sendShortcutInvalid") };
		}
		out.sendShortcut = val;
	}

	if ("followUpBehavior" in raw) {
		const val = raw.followUpBehavior;
		if (val !== "steer" && val !== "queue" && val !== "interrupt") {
			return { ok: false, error: tNow("settingsCore.validation.followUpBehaviorInvalid") };
		}
		out.followUpBehavior = val;
	}

	return { ok: true, value: out };
}
