import { describe, expect, it } from "vitest";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";
import { OMP_CONFIG_META } from "./ompConfigMeta";
import {
	FALLBACK_ON_DEFAULT,
	FALLBACK_ON_OPTIONS,
	FALLBACK_ON_VALUES,
	RESERVE_PCT_DEFAULT,
	RESERVE_POLICY_DEFAULT,
	RESERVE_POLICY_OPTIONS,
	REVERT_POLICY_DEFAULT,
	REVERT_POLICY_OPTIONS,
	pickEnum,
	validateReservePct,
} from "./fallbackSwitches";

describe("validateReservePct", () => {
	it("accepts 0..100 including decimals", () => {
		for (const v of ["0", "10", "100", "12.5", " 7 "]) expect(validateReservePct(v)).toBeNull();
	});
	it("rejects empty, non-numeric and out-of-range", () => {
		for (const v of ["", "  ", "abc", "-1", "101", "NaN"]) expect(validateReservePct(v)).not.toBeNull();
	});
});

describe("pickEnum", () => {
	it("falls back for unknown or non-string values", () => {
		expect(pickEnum("usage-limit", FALLBACK_ON_VALUES, "any")).toBe("usage-limit");
		expect(pickEnum("bogus", FALLBACK_ON_VALUES, "any")).toBe("any");
		expect(pickEnum(null, FALLBACK_ON_VALUES, "any")).toBe("any");
	});
});

describe("fallback switch tables match omp schema data", () => {
	it("options and defaults agree with meta/defaults", () => {
		const m = (k: string) => OMP_CONFIG_META[k] as { values?: string[] };
		expect(FALLBACK_ON_OPTIONS.map((o) => o.value)).toEqual(m("retry.fallbackOn").values);
		expect(REVERT_POLICY_OPTIONS.map((o) => o.value)).toEqual(m("retry.fallbackRevertPolicy").values);
		expect(RESERVE_POLICY_OPTIONS.map((o) => o.value)).toEqual(m("retry.usageReservePolicy").values);
		expect(OMP_CONFIG_DEFAULTS["retry.fallbackOn"]).toBe(FALLBACK_ON_DEFAULT);
		expect(OMP_CONFIG_DEFAULTS["retry.fallbackRevertPolicy"]).toBe(REVERT_POLICY_DEFAULT);
		expect(OMP_CONFIG_DEFAULTS["retry.usageReservePolicy"]).toBe(RESERVE_POLICY_DEFAULT);
		expect(OMP_CONFIG_DEFAULTS["retry.usageReservePct"]).toBe(RESERVE_PCT_DEFAULT);
	});
});
