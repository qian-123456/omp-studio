import { describe, expect, it } from "vitest";
import type { SecretRisk } from "./contracts";
import { applyReplacements, findValueMatches, splitPlaceholders } from "./privacy";

const e = (value: string, risk: SecretRisk, placeholder = `⟦X_${value.length.toString(16).padStart(4, "0")}⟧`) => ({
	value,
	risk,
	placeholder,
});

describe("splitPlaceholders", () => {
	it("splits ASCII and Chinese labels", () => {
		expect(splitPlaceholders("ssh ⟦服务器_IP_ab12⟧ as ⟦SECRET_00ff⟧.")).toEqual([
			{ text: "ssh " },
			{ placeholder: "⟦服务器_IP_ab12⟧" },
			{ text: " as " },
			{ placeholder: "⟦SECRET_00ff⟧" },
			{ text: "." },
		]);
	});
	it("ignores malformed tokens", () => {
		expect(splitPlaceholders("⟦X_ABCD⟧ ⟦_ab12⟧")).toEqual([
			{ text: "⟦X_ABCD⟧ ⟦_ab12⟧" },
		]);
		expect(splitPlaceholders("")).toEqual([]);
	});
});

describe("findValueMatches", () => {
	it("whole-word for risky, substring for safe", () => {
		const text = "root rooted xsecret-valuex root_1 (root)";
		const m = findValueMatches(text, [e("root", "risky"), e("secret-value", "safe")]);
		expect(m.map((x) => text.slice(x.start, x.end))).toEqual([
			"root",
			"secret-value",
			"root",
		]);
	});
	it("longest first, non-overlapping", () => {
		const text = "pw=abcdefgh123 and abcdefgh";
		const long = e("abcdefgh123", "safe");
		const short = e("abcdefgh", "safe");
		const m = findValueMatches(text, [short, long]);
		expect(m).toEqual([
			{ start: 3, end: 14, entry: long },
			{ start: 19, end: 27, entry: short },
		]);
		expect(applyReplacements(text, m)).toBe(
			`pw=${long.placeholder} and ${short.placeholder}`,
		);
	});
	it("treats CJK neighbours as boundaries", () => {
		const text = "用户root登录";
		expect(findValueMatches(text, [e("root", "risky")])).toHaveLength(1);
	});
});
