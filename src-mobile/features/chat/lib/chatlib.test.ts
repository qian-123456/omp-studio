import { describe, expect, it, vi } from "vitest";
import type { PendingEntry } from "../../../core/types";
import { countBatchApprovable, isBatchApprovable, showApproveAll } from "./approvals";
import { createTitleFlasher } from "./attention";
import { contextTone, formatContextDetail, formatContextPercent, resolveContextPercent } from "./context";
import { createDebounce, createDraftBook, draftActivityBody } from "./drafts";
import { attachmentBlocker, buildPrompt, buildPromptBody, sendIntent } from "./prompt";
import { cachedCommands, clearSlashCache, commandAction, detectSlashQuery, filterCommands, groupCommands, loadSlashCommands, parseSlashInput, type SlashCmd } from "./slash";
import { loadUnsent, saveUnsent, UNSENT_KEY } from "./unsent";

const confirmReq = (id: string): PendingEntry => ({ request: { id, method: "confirm", title: "Run tool?" } });
const approveSelect = (id: string): PendingEntry => ({
	request: { id, method: "select", title: "Allow bash?", options: ["Approve Once", "Approve", "Deny"] },
});
const question = (id: string): PendingEntry => ({ request: { id, method: "select", title: "Which db?", options: ["pg", "mysql"] } });

describe("batch approve visibility", () => {
	it("recognizes confirm and omp approval selects, never ask-user questions", () => {
		expect(isBatchApprovable(confirmReq("a"))).toBe(true);
		expect(isBatchApprovable(approveSelect("b"))).toBe(true);
		expect(isBatchApprovable(question("c"))).toBe(false);
		expect(isBatchApprovable({ request: { id: "d", method: "input", title: "Allow x" } })).toBe(false);
		expect(isBatchApprovable({ request: { id: "e", method: "select", title: "Allow x?", options: ["yes", "no"] } })).toBe(false);
	});
	it("shows the button only from two approvable requests", () => {
		expect(showApproveAll([confirmReq("a")])).toBe(false);
		expect(showApproveAll([confirmReq("a"), question("q")])).toBe(false);
		expect(showApproveAll([confirmReq("a"), approveSelect("b")])).toBe(true);
		expect(countBatchApprovable([confirmReq("a"), approveSelect("b"), question("q")])).toBe(2);
	});
});

describe("slash filtering", () => {
	const cmds: SlashCmd[] = [
		{ name: "new", title: "新会话", group: "会话" },
		{ name: "compact", title: "压缩上下文", description: "压缩 new context", group: "会话", needsArg: false },
		{ name: "fork", title: "分叉", group: "会话", needsArg: true, argHint: "<消息>" },
		{ name: "skill:visualize", title: "Visualize", group: "自定义" },
	];
	it("detects a slash query only for a bare leading /word", () => {
		expect(detectSlashQuery("/")).toBe("");
		expect(detectSlashQuery("/for")).toBe("for");
		expect(detectSlashQuery("/fork hi")).toBeNull();
		expect(detectSlashQuery("hello /x")).toBeNull();
		expect(detectSlashQuery("")).toBeNull();
	});
	it("ranks prefix before substring before title/description", () => {
		expect(filterCommands(cmds, "ne").map((c) => c.name)).toEqual(["new", "compact"]);
		expect(filterCommands(cmds, "分").map((c) => c.name)).toEqual(["fork"]);
		expect(filterCommands(cmds, "zzz")).toEqual([]);
		expect(filterCommands(cmds, "")).toHaveLength(4);
	});
	it("groups in first-seen order and decides run vs fill", () => {
		expect(groupCommands(cmds).map((g) => [g.group, g.items.length])).toEqual([["会话", 3], ["自定义", 1]]);
		expect(commandAction(cmds[0])).toBe("run");
		expect(commandAction(cmds[2])).toBe("fill");
		expect(parseSlashInput("/fork do it  ")).toEqual({ name: "fork", args: "do it" });
		expect(parseSlashInput("hello")).toBeNull();
	});
	it("caches per session and shares an in-flight request", async () => {
		clearSlashCache();
		const fetcher = vi.fn(async () => cmds);
		const [a, b] = await Promise.all([loadSlashCommands("s1", fetcher), loadSlashCommands("s1", fetcher)]);
		expect(a).toBe(b);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await loadSlashCommands("s1", fetcher);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(cachedCommands("s1")).toBe(a);
		expect(cachedCommands("s2")).toBeNull();
		await loadSlashCommands("s2", fetcher);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("does not cache a failed load", async () => {
		clearSlashCache();
		await expect(loadSlashCommands("s3", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
		expect(cachedCommands("s3")).toBeNull();
		const ok = await loadSlashCommands("s3", async () => []);
		expect(ok).toEqual([]);
	});
});

describe("prompt payloads", () => {
	it("prefixes uploaded attachments as tokens and ignores unfinished ones", () => {
		const p = buildPrompt("look", [
			{ isImage: true, status: "ok", path: "/a.png" },
			{ isImage: false, status: "ok", path: "/b.txt" },
			{ isImage: true, status: "err", path: "/c.png" },
		]);
		expect(p).toBe("[Image #1: /a.png] [文件 #1: /b.txt] look");
		expect(buildPrompt("", [{ isImage: false, status: "ok", path: "/b" }])).toBe("[文件 #1: /b]");
	});
	it("attaches streamingBehavior only while streaming", () => {
		expect(buildPromptBody("hi", false, "steer")).toEqual({ text: "hi", images: [] });
		expect(buildPromptBody("hi", true, "steer")).toEqual({ text: "hi", images: [], streamingBehavior: "steer" });
		expect(buildPromptBody("hi", true, "followUp").streamingBehavior).toBe("followUp");
	});
	it("blocks sending while uploads are pending or failed", () => {
		expect(attachmentBlocker([{ isImage: true, status: "up" }])).toContain("上传中");
		expect(attachmentBlocker([{ isImage: true, status: "err" }])).toContain("失败");
		expect(attachmentBlocker([{ isImage: true, status: "ok", path: "x" }])).toBeNull();
	});
	it("send button intent", () => {
		expect(sendIntent("", 0, true)).toBe("stop");
		expect(sendIntent("  ", 0, false)).toBe("none");
		expect(sendIntent("/new", 0, false)).toBe("slash");
		expect(sendIntent("/new", 1, false)).toBe("prompt");
		expect(sendIntent("hi", 0, true)).toBe("prompt");
	});
});

describe("context usage", () => {
	it("formats percent", () => {
		expect(formatContextPercent(37.4)).toBe("37%");
		expect(formatContextPercent(0.2)).toBe("<1%");
		expect(formatContextPercent(0)).toBe("0%");
		expect(formatContextPercent(130)).toBe("100%");
		expect(formatContextPercent(null)).toBeNull();
		expect(formatContextPercent(Number.NaN)).toBeNull();
	});
	it("tones and detail", () => {
		expect(contextTone(50)).toBe("neutral");
		expect(contextTone(75)).toBe("warn");
		expect(contextTone(95)).toBe("danger");
		expect(formatContextDetail({ contextTokens: 12_300, contextWindow: 200_000 })).toBe("已用 12.3K / 200K");
		expect(formatContextDetail({ contextTokens: 900 })).toBe("已用 900");
		expect(formatContextDetail({})).toBeNull();
		expect(resolveContextPercent({ contextTokens: 50, contextWindow: 200 })).toBe(25);
		expect(resolveContextPercent({ contextPercent: 12, contextTokens: 50, contextWindow: 200 })).toBe(12);
	});
});

describe("draft book", () => {
	it("keeps a meaningful draft across unmount and drops a blank one", () => {
		const b = createDraftBook<string>();
		expect(b.stash("mobile-draft-1", "hello", [])).toBe(true);
		expect(b.restore("mobile-draft-1")).toEqual({ text: "hello", atts: [] });
		expect(b.stash("mobile-draft-1", "  ", [])).toBe(false);
		expect(b.restore("mobile-draft-1")).toBeNull();
		expect(b.stash("mobile-draft-2", "", ["att"])).toBe(true);
	});
	it("hands the first prompt to the real id exactly once", () => {
		const b = createDraftBook<string>();
		b.stash("mobile-draft-1", "x", []);
		b.handoff("mobile-draft-1", "real-1", "first prompt");
		expect(b.restore("mobile-draft-1")).toBeNull();
		expect(b.takeHandoff("other")).toBeNull();
		expect(b.takeHandoff("real-1")).toBeNull(); // a mismatching mount cleared it
		b.handoff("mobile-draft-1", "real-1", "first prompt");
		expect(b.takeHandoff("real-1")).toEqual({ id: "real-1", text: "first prompt" });
		expect(b.takeHandoff("real-1")).toBeNull();
	});
	it("builds the draft-activity body", () => {
		expect(draftActivityBody(true, false)).toEqual({ active: true, meaningful: false });
	});
	it("debounces draft touches to one trailing call", () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = createDebounce(fn, 600);
		d.call();
		vi.advanceTimersByTime(500);
		d.call();
		vi.advanceTimersByTime(500);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		d.call();
		d.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});

describe("unsent text persistence", () => {
	const mem = (): Storage => {
		const m = new Map<string, string>();
		return {
			getItem: (k) => m.get(k) ?? null,
			setItem: (k, v) => void m.set(k, v),
			removeItem: (k) => void m.delete(k),
			clear: () => m.clear(),
			key: () => null,
			get length() {
				return m.size;
			},
		};
	};
	it("round-trips per session and clears on empty", () => {
		const s = mem();
		saveUnsent("a", "draft a", s);
		saveUnsent("b", "draft b", s);
		expect(loadUnsent("a", s)).toBe("draft a");
		expect(loadUnsent("b", s)).toBe("draft b");
		saveUnsent("a", "", s);
		expect(loadUnsent("a", s)).toBe("");
		saveUnsent("b", "  ", s);
		expect(s.getItem(UNSENT_KEY)).toBeNull();
	});
	it("expires stale entries and survives corrupt storage", () => {
		const s = mem();
		const old = Date.now() - 30 * 24 * 3600 * 1000;
		saveUnsent("old", "stale", s, old);
		saveUnsent("new", "fresh", s);
		expect(loadUnsent("old", s)).toBe("");
		expect(loadUnsent("new", s)).toBe("fresh");
		s.setItem(UNSENT_KEY, "{not json");
		expect(loadUnsent("new", s)).toBe("");
	});
});

describe("title flasher", () => {
	it("alternates and restores the title", () => {
		vi.useFakeTimers();
		const doc = { title: "OMP" };
		const f = createTitleFlasher(doc);
		f.start("【已完成】");
		vi.advanceTimersByTime(900);
		expect(doc.title).toBe("【已完成】");
		vi.advanceTimersByTime(900);
		expect(doc.title).toBe("OMP");
		vi.advanceTimersByTime(900);
		f.stop();
		expect(doc.title).toBe("OMP");
		expect(f.active()).toBe(false);
		vi.useRealTimers();
	});
});
