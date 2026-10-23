import { describe, expect, it } from "vitest";
import type { SecretEntry } from "../../../lib/contracts";
import {
	EMPTY_DRAFT,
	addMark,
	computeHighlights,
	defaultMarkScope,
	libraryPromptCandidates,
	maskText,
	needsScopeChoice,
	rebaseDraft,
	rebaseRanges,
	replacedEntries,
	resolveLinkScope,
	toggleHighlight,
	type PrivacyDraft,
} from "./composerPrivacy";

function entry(id: string, value: string, patch: Partial<SecretEntry> = {}): SecretEntry {
	return {
		id,
		value,
		label: null,
		placeholder: `⟦SECRET_${id.padStart(4, "0").slice(0, 4)}⟧`,
		aliases: [],
		risk: "safe",
		track: true,
		inLibrary: false,
		libraryPrompted: false,
		createdAt: "2026-01-01T00:00:00Z",
		sessionCount: 0,
		...patch,
	};
}

const PW = entry("a1a1", "hunter2-secret", { label: "PW", placeholder: "⟦PW_a1a1⟧" });
const ROOT = entry("b2b2", "root", { risk: "risky", placeholder: "⟦SECRET_b2b2⟧" });
const ONEOFF = entry("c3c3", "10.0.0.7x", { track: false, placeholder: "⟦IP_c3c3⟧" });
const LIB = entry("d4d4", "libvalue123", { inLibrary: true, placeholder: "⟦SECRET_d4d4⟧" });
const OTHER = entry("e5e5", "othersession", { placeholder: "⟦SECRET_e5e5⟧" });

const ALL = [PW, ROOT, ONEOFF, LIB, OTHER];
const SESSION = new Set([PW.id, ROOT.id, ONEOFF.id]);

function highlights(text: string, draft: PrivacyDraft = { ...EMPTY_DRAFT, text }) {
	return computeHighlights({ text, draft, entries: ALL, sessionEntryIds: SESSION });
}

describe("computeHighlights", () => {
	it("classifies auto safe, risky suggestion, library and ignores other sessions", () => {
		const text = "pw hunter2-secret as root, lib libvalue123, x othersession";
		const hs = highlights(text);
		expect(hs.map((h) => [h.entry.id, h.kind])).toEqual([
			[PW.id, "auto"],
			[ROOT.id, "suggestion"],
			[LIB.id, "auto"],
		]);
	});

	it("never auto-detects track=false entries but keeps explicit marks of them", () => {
		const text = "ip 10.0.0.7x and 10.0.0.7x";
		expect(highlights(text)).toEqual([]);
		const draft = addMark({ ...EMPTY_DRAFT, text }, { start: 3, end: 12, entry: ONEOFF });
		const hs = highlights(text, draft);
		expect(hs.map((h) => [h.start, h.kind])).toEqual([[3, "marked"]]);
		expect(maskText(text, hs)).toBe("ip ⟦IP_c3c3⟧ and 10.0.0.7x");
	});

	it("drops a mark whose text no longer matches the entry value", () => {
		const text = "xx hunter2-secreT";
		const draft = addMark({ ...EMPTY_DRAFT, text }, { start: 3, end: 17, entry: PW });
		expect(highlights(text, draft)).toEqual([]);
	});
});

describe("masking", () => {
	const text = "login root with hunter2-secret then hunter2-secret";

	it("replaces auto values, leaves risky suggestions", () => {
		const hs = highlights(text);
		expect(maskText(text, hs)).toBe("login root with ⟦PW_a1a1⟧ then ⟦PW_a1a1⟧");
		expect(replacedEntries(hs).map((e) => e.id)).toEqual([PW.id]);
	});

	it("undo excludes one occurrence; toggling again restores it", () => {
		let draft: PrivacyDraft = { ...EMPTY_DRAFT, text };
		const first = highlights(text, draft).find((h) => h.entry.id === PW.id);
		if (!first) throw new Error("missing highlight");
		draft = toggleHighlight(draft, first);
		let hs = highlights(text, draft);
		expect(hs.find((h) => h.start === first.start)?.kind).toBe("undone");
		expect(maskText(text, hs)).toBe("login root with hunter2-secret then ⟦PW_a1a1⟧");
		const undone = hs.find((h) => h.kind === "undone");
		if (!undone) throw new Error("missing undone");
		draft = toggleHighlight(draft, undone);
		hs = highlights(text, draft);
		expect(maskText(text, hs)).toBe("login root with ⟦PW_a1a1⟧ then ⟦PW_a1a1⟧");
	});

	it("risky suggestion is replaced only after being accepted", () => {
		let draft: PrivacyDraft = { ...EMPTY_DRAFT, text };
		const sug = highlights(text, draft).find((h) => h.kind === "suggestion");
		if (!sug) throw new Error("missing suggestion");
		draft = toggleHighlight(draft, sug);
		const hs = highlights(text, draft);
		expect(hs.find((h) => h.entry.id === ROOT.id)?.kind).toBe("accepted");
		expect(maskText(text, hs)).toBe("login ⟦SECRET_b2b2⟧ with ⟦PW_a1a1⟧ then ⟦PW_a1a1⟧");
	});

	it("undoing an explicit mark sends the real text", () => {
		const t = "ip 10.0.0.7x";
		let draft = addMark({ ...EMPTY_DRAFT, text: t }, { start: 3, end: 12, entry: ONEOFF });
		const [mark] = highlights(t, draft);
		draft = toggleHighlight(draft, mark);
		expect(maskText(t, highlights(t, draft))).toBe(t);
	});

	it("uses the store's current placeholder after a label edit", () => {
		const t = "ip 10.0.0.7x";
		const draft = addMark({ ...EMPTY_DRAFT, text: t }, { start: 3, end: 12, entry: ONEOFF });
		const renamed = { ...ONEOFF, placeholder: "⟦HOST_ffff⟧" };
		const hs = computeHighlights({ text: t, draft, entries: [renamed], sessionEntryIds: SESSION });
		expect(maskText(t, hs)).toBe("ip ⟦HOST_ffff⟧");
	});
});

describe("rebase", () => {
	it("shifts ranges after an edit and keeps those before", () => {
		const r = [
			{ start: 0, end: 2 },
			{ start: 5, end: 8 },
		];
		expect(rebaseRanges(r, "ab   cde", "ab XX   cde")).toEqual([
			{ start: 0, end: 2 },
			{ start: 8, end: 11 },
		]);
	});

	it("drops ranges touched by the edit", () => {
		expect(rebaseRanges([{ start: 2, end: 6 }], "a bcde f", "a bXde f")).toEqual([]);
	});

	it("typing right after or before a range keeps it intact", () => {
		const r = [{ start: 2, end: 5 }];
		expect(rebaseRanges(r, "a xyz", "a xyzq")).toEqual(r);
		expect(rebaseRanges(r, "a xyz", "a qxyz")).toEqual([{ start: 3, end: 6 }]);
	});

	it("keeps explicit marks bound to the moved value", () => {
		const t = "ip 10.0.0.7x";
		const draft = addMark({ ...EMPTY_DRAFT, text: t }, { start: 3, end: 12, entry: ONEOFF });
		const next = `host ${t}`;
		const moved = rebaseDraft(draft, next);
		expect(maskText(next, highlights(next, moved))).toBe("host ip ⟦IP_c3c3⟧");
	});
});

describe("libraryPromptCandidates", () => {
	it("lists session entries not in library and not yet prompted", () => {
		const prompted = { ...PW, libraryPrompted: true };
		expect(
			libraryPromptCandidates([prompted, ROOT, ONEOFF, LIB, OTHER], SESSION).map((e) => e.id),
		).toEqual([ROOT.id, ONEOFF.id]);
	});
});

describe("mark scope", () => {
	it("only asks for a scope when the value was already sent", () => {
		expect(needsScopeChoice(0)).toBe(false);
		expect(needsScopeChoice(3)).toBe(true);
		expect(defaultMarkScope(0)).toBe("all");
		expect(defaultMarkScope(2)).toBe("future");
	});

	it("remembers the chosen scope per entry and keeps it across rebases", () => {
		const t = "pw hunter2-secret";
		let draft = addMark({ ...EMPTY_DRAFT, text: t }, { start: 3, end: 17, entry: PW }, "future");
		expect(draft.scopes).toEqual({ [PW.id]: "future" });
		draft = rebaseDraft(draft, `${t} more`);
		expect(draft.scopes[PW.id]).toBe("future");
		// A mark without an explicit scope does not touch remembered scopes.
		draft = addMark(draft, { start: 3, end: 17, entry: PW });
		expect(draft.scopes[PW.id]).toBe("future");
	});

	it("resolves the link scope: remembered wins, else transcript presence decides", () => {
		expect(resolveLinkScope("all", 5)).toBe("all");
		expect(resolveLinkScope("future", 0)).toBe("future");
		expect(resolveLinkScope(undefined, 1)).toBe("future");
		expect(resolveLinkScope(undefined, 0)).toBe("all");
	});

	it("masks by the entry's fixed placeholder regardless of label edits", () => {
		const t = "pw hunter2-secret";
		const draft = addMark({ ...EMPTY_DRAFT, text: t }, { start: 3, end: 17, entry: PW });
		const renamed = { ...PW, label: "新名称" };
		const hs = computeHighlights({ text: t, draft, entries: [renamed], sessionEntryIds: SESSION });
		expect(maskText(t, hs)).toBe("pw ⟦PW_a1a1⟧");
	});
});
