/** Pure option tables and validation for the fallback switches card (FallbackSwitchesCard). */

export const FALLBACK_ON_VALUES = ["any", "usage-limit", "except-usage-limit"] as const;
export type FallbackOn = (typeof FALLBACK_ON_VALUES)[number];

export const REVERT_POLICY_VALUES = ["cooldown-expiry", "never"] as const;
export type RevertPolicy = (typeof REVERT_POLICY_VALUES)[number];

export const RESERVE_POLICY_VALUES = ["confirm", "auto", "fail-closed"] as const;
export type ReservePolicy = (typeof RESERVE_POLICY_VALUES)[number];

export const FALLBACK_ON_DEFAULT: FallbackOn = "any";
export const REVERT_POLICY_DEFAULT: RevertPolicy = "cooldown-expiry";
export const RESERVE_POLICY_DEFAULT: ReservePolicy = "confirm";
export const RESERVE_PCT_DEFAULT = 10;

export const FALLBACK_ON_OPTIONS: { value: FallbackOn; label: string; note: string }[] = [
	{ value: "any", label: "任何错误", note: "任何错误都回退" },
	{ value: "usage-limit", label: "仅用量耗尽", note: "仅用量或配额耗尽时回退，其他错误只重试" },
	{ value: "except-usage-limit", label: "用量耗尽除外", note: "用量耗尽时不回退，其余错误回退" },
];

export const REVERT_POLICY_OPTIONS: { value: RevertPolicy; label: string; note: string }[] = [
	{ value: "cooldown-expiry", label: "自动切回", note: "冷却结束自动切回主模型" },
	{ value: "never", label: "留在备用", note: "一直留在回退模型，直到你手动切换" },
];

export const RESERVE_POLICY_OPTIONS: { value: ReservePolicy; label: string; note: string }[] = [
	{ value: "confirm", label: "先问我", note: "交互会话保持主模型并等你确认；后台代理自动回退" },
	{ value: "auto", label: "自动回退", note: "直接换到下一个可用的备用模型" },
	{ value: "fail-closed", label: "不再使用", note: "不动用预留额度，也不回退，请求直接失败" },
];

/** Narrow a raw config value to one of `allowed`, else `fallback`. */
export function pickEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
	return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Validate the reserve percentage input: a number from 0 to 100. Returns an error message or null. */
export function validateReservePct(text: string): string | null {
	const t = text.trim();
	if (t === "") return "请输入 0 到 100 的数字";
	const n = Number(t);
	if (!Number.isFinite(n)) return "请输入 0 到 100 的数字";
	if (n < 0 || n > 100) return "百分比需在 0 到 100 之间";
	return null;
}
