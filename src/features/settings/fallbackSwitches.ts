/** Pure option tables and validation for the fallback switches card (FallbackSwitchesCard). */

import { tNow } from "../../stores/language";
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
	{
		value: "any",
		get label() {
			return tNow("settingsModels.fallbackOnAnyLabel");
		},
		get note() {
			return tNow("settingsModels.fallbackOnAnyNote");
		},
	},
	{
		value: "usage-limit",
		get label() {
			return tNow("settingsModels.fallbackOnUsageLabel");
		},
		get note() {
			return tNow("settingsModels.fallbackOnUsageNote");
		},
	},
	{
		value: "except-usage-limit",
		get label() {
			return tNow("settingsModels.fallbackOnExceptUsageLabel");
		},
		get note() {
			return tNow("settingsModels.fallbackOnExceptUsageNote");
		},
	},
];

export const REVERT_POLICY_OPTIONS: { value: RevertPolicy; label: string; note: string }[] = [
	{
		value: "cooldown-expiry",
		get label() {
			return tNow("settingsModels.revertExpiryLabel");
		},
		get note() {
			return tNow("settingsModels.revertExpiryNote");
		},
	},
	{
		value: "never",
		get label() {
			return tNow("settingsModels.revertNeverLabel");
		},
		get note() {
			return tNow("settingsModels.revertNeverNote");
		},
	},
];

export const RESERVE_POLICY_OPTIONS: { value: ReservePolicy; label: string; note: string }[] = [
	{
		value: "confirm",
		get label() {
			return tNow("settingsModels.reserveConfirmLabel");
		},
		get note() {
			return tNow("settingsModels.reserveConfirmNote");
		},
	},
	{
		value: "auto",
		get label() {
			return tNow("settingsModels.reserveAutoLabel");
		},
		get note() {
			return tNow("settingsModels.reserveAutoNote");
		},
	},
	{
		value: "fail-closed",
		get label() {
			return tNow("settingsModels.reserveFailClosedLabel");
		},
		get note() {
			return tNow("settingsModels.reserveFailClosedNote");
		},
	},
];

/** Narrow a raw config value to one of `allowed`, else `fallback`. */
export function pickEnum<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
	return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Validate the reserve percentage input: a number from 0 to 100. Returns an error message or null. */
export function validateReservePct(text: string): string | null {
	const t = text.trim();
	if (t === "") return tNow("settingsModels.reservePctEmpty");
	const n = Number(t);
	if (!Number.isFinite(n)) return tNow("settingsModels.reservePctEmpty");
	if (n < 0 || n > 100) return tNow("settingsModels.reservePctRange");
	return null;
}
