import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { trimSideChatItems } from "./sideChatView";

const u = (id: string, text: string) => ({ id, kind: "user", text }) as TranscriptItem;
const legacy = (sel: string, q: string) =>
	`You are a **side chat** forked from main session #1 ("t"), working in \`/x\`.\n\n## Context from the main session\nctx\n\n${
		sel ? `## Selected text the user is asking about\n> ${sel}\n\n` : ""
	}## User question\n${q}`;

const tpl = (sel: string, q: string) =>
	`Side chat forked from main session #1 ("t"), working in \`/x\`.\n\n## Context from the main session\nctx\n\n${
		sel ? `## Selected text the user is asking about\n> ${sel}\n\n` : ""
	}## User question\n${q}`;

describe("trimSideChatItems", () => {
	it("still recognises the legacy template", () => {
		const out = trimSideChatItems([u("1", "parent"), u("2", legacy("", "旧问题"))]);
		expect(out.map((i) => i.text)).toEqual(["旧问题"]);
	});
	it("drops inherited parent history and shows only the typed question", () => {
		const out = trimSideChatItems([u("1", "parent msg"), u("2", tpl("", "为什么这么久？")), u("3", "follow-up")]);
		expect(out.map((i) => i.id)).toEqual(["2", "3"]);
		expect(out[0].text).toBe("为什么这么久？");
	});
	it("includes the quoted selection", () => {
		const out = trimSideChatItems([u("2", tpl("引用", "问题"))]);
		expect(out[0].text).toBe("> 引用\n\n问题");
	});
	it("known side chat without a prompt yet shows no inherited history", () => {
		expect(trimSideChatItems([u("1", "parent msg")], true)).toEqual([]);
	});
	it("leaves ordinary sessions untouched", () => {
		const items = [u("1", "hi")];
		expect(trimSideChatItems(items)).toBe(items);
	});
	it("nested fork: uses the last side-chat prompt", () => {
		const out = trimSideChatItems([u("1", tpl("", "A")), u("2", "x"), u("3", tpl("", "B"))]);
		expect(out.map((i) => i.text)).toEqual(["B"]);
	});
});
