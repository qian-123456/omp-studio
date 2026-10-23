import { describe, expect, it } from "vitest";
import type { SecretEntry } from "../../lib/contracts";
import { SECRET_CHIP_TAG, rehypeSecretChips, resolveReveal, segmentPrivacyText } from "./render";

function entry(over: Partial<SecretEntry>): SecretEntry {
	return {
		id: "e1",
		value: "hunter2pass",
		label: "DB密码",
		placeholder: "⟦DB密码_a1b2⟧",
		aliases: [],
		risk: "safe",
		track: true,
		inLibrary: false,
		libraryPrompted: false,
		createdAt: "2026-01-01T00:00:00Z",
		sessionCount: 0,
		...over,
	};
}

const pw = entry({ aliases: ["⟦SECRET_0000⟧"] });
const user = entry({ id: "e2", value: "root", label: null, placeholder: "⟦SECRET_beef⟧", risk: "risky" });
const untracked = entry({ id: "e3", value: "10.0.0.42", label: "IP", placeholder: "⟦IP_cafe⟧", track: false });
const byPlaceholder = new Map<string, SecretEntry>([
	[pw.placeholder, pw],
	["⟦SECRET_0000⟧", pw],
	[user.placeholder, user],
	[untracked.placeholder, untracked],
]);

describe("segmentPrivacyText", () => {
	it("splits known placeholders (current + alias) into chips", () => {
		expect(segmentPrivacyText("login ⟦DB密码_a1b2⟧ or ⟦SECRET_0000⟧.", byPlaceholder, null)).toEqual([
			{ kind: "text", text: "login " },
			{ kind: "chip", entry: pw, raw: "⟦DB密码_a1b2⟧" },
			{ kind: "text", text: " or " },
			{ kind: "chip", entry: pw, raw: "⟦SECRET_0000⟧" },
			{ kind: "text", text: "." },
		]);
	});

	it("keeps unknown placeholders as plain text", () => {
		expect(segmentPrivacyText("a ⟦X_ffff⟧ b", byPlaceholder, null)).toEqual([{ kind: "text", text: "a ⟦X_ffff⟧ b" }]);
	});

	it("does not match real values without tracked entries", () => {
		expect(segmentPrivacyText("pw=hunter2pass", byPlaceholder, null)).toEqual([{ kind: "text", text: "pw=hunter2pass" }]);
	});

	it("chips tracked real values in tool output; risky ones whole-word only", () => {
		const tracked = [pw, user];
		const segs = segmentPrivacyText("ssh root@h -p hunter2pass rootless", byPlaceholder, tracked);
		expect(segs).toEqual([
			{ kind: "text", text: "ssh " },
			{ kind: "chip", entry: user, raw: "root" },
			{ kind: "text", text: "@h -p " },
			{ kind: "chip", entry: pw, raw: "hunter2pass" },
			{ kind: "text", text: " rootless" },
		]);
	});

	it("mixes placeholders and real values", () => {
		const segs = segmentPrivacyText("⟦IP_cafe⟧ hunter2pass", byPlaceholder, [pw]);
		expect(segs.map((s) => s.kind)).toEqual(["chip", "text", "chip"]);
	});
});

describe("resolveReveal", () => {
	it("defaults to revealed when the setting is unset", () => {
		expect(resolveReveal(null, null)).toBe(true);
		expect(resolveReveal(undefined, null)).toBe(true);
	});
	it("follows the setting until toggled", () => {
		expect(resolveReveal(false, null)).toBe(false);
		expect(resolveReveal(false, true)).toBe(true);
		expect(resolveReveal(true, false)).toBe(false);
	});
});

describe("rehypeSecretChips", () => {
	it("wraps placeholders in nested text nodes (code included)", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "element",
					tagName: "code",
					children: [{ type: "text" as const, value: "pass ⟦DB密码_a1b2⟧!" }],
				},
			],
		};
		rehypeSecretChips()(tree);
		expect(tree.children[0]?.children).toEqual([
			{ type: "text", value: "pass " },
			{ type: "element", tagName: SECRET_CHIP_TAG, properties: {}, children: [{ type: "text", value: "⟦DB密码_a1b2⟧" }] },
			{ type: "text", value: "!" },
		]);
	});
});
