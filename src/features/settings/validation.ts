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
		return { ok: false, error: "导入的数据必须是 JSON 对象" };
	}

	const raw = input as Record<string, unknown>;
	const out: Partial<Settings> = {};

	const boolKeys: (keyof Settings)[] = [
		"systemDetection",
		"supervisorEnabled",
		"smartContextRouting",
		"notifyTurnEnd",
		"notifyApproval",
		"notifyExit",
		"notifySound",
		"capsuleVisible",
		"mobileEnabled",
		"homeShowCompletedTodos",
		"dockBadgeEnabled",
		"sessionTurnAutoRefresh",
		"sessionGroupByWorktree",
		"visualizeEnabled",
	];

	for (const k of boolKeys) {
		if (k in raw) {
			if (typeof raw[k] !== "boolean") {
				return { ok: false, error: `字段 ${k} 必须为布尔值` };
			}
			(out as Record<string, unknown>)[k] = raw[k];
		}
	}

	if ("turnCheckpoints" in raw) {
		if (raw.turnCheckpoints !== null && typeof raw.turnCheckpoints !== "boolean") {
			return { ok: false, error: "字段 turnCheckpoints 必须为布尔值或 null" };
		}
		out.turnCheckpoints = raw.turnCheckpoints as boolean | null;
	}

	if ("queueAutoSend" in raw) {
		if (raw.queueAutoSend !== null && typeof raw.queueAutoSend !== "boolean") {
			return { ok: false, error: "字段 queueAutoSend 必须为布尔值或 null" };
		}
		out.queueAutoSend = raw.queueAutoSend as boolean | null;
	}

	if ("privacyRevealDefault" in raw) {
		if (
			raw.privacyRevealDefault !== null &&
			typeof raw.privacyRevealDefault !== "boolean"
		) {
			return { ok: false, error: "字段 privacyRevealDefault 必须为布尔值或 null" };
		}
		out.privacyRevealDefault = raw.privacyRevealDefault as boolean | null;
	}

	if ("ompAutoUpdate" in raw) {
		if (raw.ompAutoUpdate !== null && typeof raw.ompAutoUpdate !== "boolean") {
			return { ok: false, error: "字段 ompAutoUpdate 必须为布尔值或 null" };
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
				error: `不支持的默认审批模式: ${String(raw.defaultApprovalMode)}`,
			};
		}
		out.defaultApprovalMode = raw.defaultApprovalMode;
	}

	if ("tunnelMode" in raw) {
		if (typeof raw.tunnelMode !== "string" || !VALID_TUNNEL_MODES[raw.tunnelMode]) {
			return {
				ok: false,
				error: `不支持的隧道模式: ${String(raw.tunnelMode)}`,
			};
		}
		out.tunnelMode = raw.tunnelMode;
	}

	if ("mobilePort" in raw) {
		const port = raw.mobilePort;
		if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
			return { ok: false, error: "移动端端口号必须是 1 到 65535 之间的整数" };
		}
		out.mobilePort = port;
	}

	if ("supervisorIntervalMinutes" in raw) {
		const val = raw.supervisorIntervalMinutes;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 10080) {
			return { ok: false, error: "监工触发间隔必须是 0 到 10080 分钟之间的整数" };
		}
		out.supervisorIntervalMinutes = val;
	}

	if ("inboxWindowHours" in raw) {
		const val = raw.inboxWindowHours;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 720) {
			return { ok: false, error: "收件箱自动移出时间必须是 1 到 720 小时之间的整数" };
		}
		out.inboxWindowHours = val;
	}

	if ("ompCheckIntervalHours" in raw) {
		const val = raw.ompCheckIntervalHours;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 720) {
			return { ok: false, error: "omp 自动检查间隔必须是 1 到 720 小时之间的整数" };
		}
		out.ompCheckIntervalHours = val;
	}

	if ("idleSuspendMinutes" in raw) {
		const val = raw.idleSuspendMinutes;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 1440) {
			return { ok: false, error: "空闲挂起时长必须是 0 到 1440 分钟之间的整数" };
		}
		out.idleSuspendMinutes = val;
	}

	if ("ompBinary" in raw) {
		const val = raw.ompBinary;
		if (typeof val !== "string" || val.trim().length === 0) {
			return { ok: false, error: "OMP 可执行文件路径不能为空" };
		}
		if (/[\0\r\n]/.test(val)) {
			return { ok: false, error: "OMP 可执行文件路径不能包含空字符或换行符" };
		}
		out.ompBinary = val;
	}

	if ("supervisorModel" in raw) {
		const val = raw.supervisorModel;
		if (typeof val !== "string" || val.trim().length === 0) {
			return { ok: false, error: "监工模型不能为空" };
		}
		if (/[\0\r\n]/.test(val)) {
			return { ok: false, error: "监工模型不能包含空字符或换行符" };
		}
		out.supervisorModel = val;
	}

	if ("quickCaptureShortcut" in raw) {
		const val = raw.quickCaptureShortcut;
		if (typeof val !== "string") {
			return { ok: false, error: "快捷键必须是字符串" };
		}
		if (/[\0\r\n]/.test(val)) {
			return { ok: false, error: "快捷键不能包含空字符或换行符" };
		}
		out.quickCaptureShortcut = val;
	}

	if ("tunnelName" in raw) {
		const val = raw.tunnelName;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: "隧道名称必须是字符串或 null" };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: "隧道名称不能包含空字符或换行符" };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: "隧道名称不能以 '-' 开头" };
			}
		}
		out.tunnelName = val;
	}

	if ("tunnelHostname" in raw) {
		const val = raw.tunnelHostname;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: "公网域名必须是字符串或 null" };
		}
		if (typeof val === "string" && /[\0\r\n]/.test(val)) {
			return { ok: false, error: "公网域名不能包含空字符或换行符" };
		}
		out.tunnelHostname = val;
	}

	if ("newSessionModel" in raw) {
		const val = raw.newSessionModel;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: "新会话默认模型必须是字符串或 null" };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: "新会话默认模型不能包含空字符或换行符" };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: "新会话默认模型不能以 '-' 开头" };
			}
		}
		out.newSessionModel = val;
	}

	if ("sideChatModel" in raw) {
		const val = raw.sideChatModel;
		if (val !== null && typeof val !== "string") {
			return { ok: false, error: "侧聊专属模型必须是字符串或 null" };
		}
		if (typeof val === "string") {
			if (/[\0\r\n]/.test(val)) {
				return { ok: false, error: "侧聊专属模型不能包含空字符或换行符" };
			}
			if (val.trim().startsWith("-")) {
				return { ok: false, error: "侧聊专属模型不能以 '-' 开头" };
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
			return { ok: false, error: "免打扰开始时间必须是 HH:MM 格式或 null" };
		}
		if (to !== null && typeof to !== "string") {
			return { ok: false, error: "免打扰结束时间必须是 HH:MM 格式或 null" };
		}
		if ((from === null && to !== null) || (from !== null && to === null)) {
			return { ok: false, error: "免打扰开始和结束时间需要同时设置或同时清空" };
		}
		if (typeof from === "string" && !isValidHhmm(from)) {
			return { ok: false, error: `免打扰开始时间格式无效 (当前 "${from}")，需要 HH:MM` };
		}
		if (typeof to === "string" && !isValidHhmm(to)) {
			return { ok: false, error: `免打扰结束时间格式无效 (当前 "${to}")，需要 HH:MM` };
		}
		out.notifyQuietFrom = from;
		out.notifyQuietTo = to;
	}

	if ("gitDeliveryMode" in raw) {
		const val = raw.gitDeliveryMode;
		if (val !== "pr" && val !== "direct" && val !== null && val !== undefined) {
			return { ok: false, error: "主干交付模式必须为 pr 或 direct" };
		}
		if (typeof val === "string") {
			out.gitDeliveryMode = val;
		}
	}

	if ("doctorModel" in raw) {
		const val = raw.doctorModel;
		if (typeof val !== "string" || /[\0\r\n]/.test(val)) {
			return { ok: false, error: "诊断模型必须是字符串且不能包含空字符或换行符" };
		}
		out.doctorModel = val;
	}

	if ("doctorAutoMode" in raw) {
		const val = raw.doctorAutoMode;
		if (val !== "manual" && val !== "idle" && val !== "scheduled") {
			return { ok: false, error: "自动会诊模式必须为 manual、idle 或 scheduled" };
		}
		out.doctorAutoMode = val;
	}

	if ("doctorIdleMinutes" in raw) {
		const val = raw.doctorIdleMinutes;
		if (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 10080) {
			return { ok: false, error: "会诊闲置分钟必须是 1–10080 的整数" };
		}
		out.doctorIdleMinutes = val;
	}

	if ("doctorScheduleTime" in raw) {
		const val = raw.doctorScheduleTime;
		if (typeof val !== "string" || !isValidHhmm(val)) {
			return { ok: false, error: "每日会诊时间需要 HH:MM 格式" };
		}
		out.doctorScheduleTime = val;
	}

	if ("sendShortcut" in raw) {
		const val = raw.sendShortcut;
		if (val !== "enter" && val !== "mod-enter") {
			return { ok: false, error: "发送快捷键必须为 enter 或 mod-enter" };
		}
		out.sendShortcut = val;
	}

	if ("followUpBehavior" in raw) {
		const val = raw.followUpBehavior;
		if (val !== "steer" && val !== "queue" && val !== "interrupt") {
			return { ok: false, error: "任务进行中发送方式必须为 steer、queue 或 interrupt" };
		}
		out.followUpBehavior = val;
	}

	return { ok: true, value: out };
}
