import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import type { SessionLive } from "../../stores/live";
import {
	clearSnapshot,
	loadSnapshot,
	mergeSnapshotIntoLive,
	saveSnapshot,
	snapshotContinues,
	snapshotFromLive,
	snapshotInItems,
	unfinishedDisplay,
} from "./streamSnapshot";

const mem = new Map<string, string>();
beforeEach(() => {
	mem.clear();
	globalThis.localStorage = {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => void mem.set(k, String(v)),
		removeItem: (k: string) => void mem.delete(k),
		clear: () => mem.clear(),
		key: (i: number) => [...mem.keys()][i] ?? null,
		get length() {
			return mem.size;
		},
	} as Storage;
});

const NOW = 1_700_000_000_000;

const liveBase = (): SessionLive => ({
	streaming: true,
	state: null,
	pendingUi: [],
	subagents: {},
	streamingMessage: null,
	commands: [],
	commandOutputs: [],
	pendingCommand: null,
	liveRequests: [],
	flowNotices: [],
	ompQueue: { steering: [], followUp: [] },
	tools: {},
	items: [],
	pendingUserEchoes: [],
	nextOffset: 0,
	alive: true,
	scrollRequest: null,
	thinkingStartedAt: null,
	thinkingEndedAt: null,
	thinkingDurations: {},
});

const textMsg = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
});

describe("snapshotFromLive", () => {
	it("returns null when there is nothing to lose", () => {
		expect(snapshotFromLive(liveBase(), NOW)).toBeNull();
		const idle = { ...liveBase(), streaming: false, streamingMessage: textMsg("hi") };
		expect(snapshotFromLive(idle as SessionLive, NOW)).toBeNull();
	});

	it("captures the in-flight message, tools, requests and timing", () => {
		const live = {
			...liveBase(),
			streamingMessage: textMsg("正在写一半的回答"),
			tools: {
				c1: {
					toolCallId: "c1",
					toolName: "bash",
					args: { cmd: "ls" },
					intent: null,
					status: "running",
					text: "",
					details: null,
					startedAt: NOW - 5,
				},
			},
			liveRequests: [
				{
					id: "r1",
					toolCallIds: [],
					hasText: true,
					parts: [{ kind: "text", text: "第一段" }],
					stat: { startedAt: null, completedAt: null, durationMs: null, ttftMs: null, usage: null, error: null },
				},
			],
			turnStartedAt: NOW - 100,
			thinkingStartedAt: NOW - 90,
			thinkingEndedAt: NOW - 50,
		} as SessionLive;
		const snap = snapshotFromLive(live, NOW);
		expect(snap).not.toBeNull();
		expect(snap?.answerText).toBe("正在写一半的回答");
		expect(snap?.toolIds).toEqual([]);
		expect(snap?.turnStartedAt).toBe(NOW - 100);
		expect(snap?.liveRequests).toHaveLength(1);
		expect(snap?.tools.c1.toolName).toBe("bash");
	});

	it("truncates huge tool output and drops huge details", () => {
		const live = {
			...liveBase(),
			streamingMessage: null,
			tools: {
				c1: {
					toolCallId: "c1",
					toolName: "read",
					args: {},
					intent: null,
					status: "done",
					text: "x".repeat(9000),
					details: { blob: "y".repeat(20000) },
					startedAt: NOW,
				},
			},
		} as SessionLive;
		const snap = snapshotFromLive(live, NOW);
		expect(snap?.tools.c1.text.length).toBeLessThan(9000);
		expect(snap?.tools.c1.details).toBeNull();
	});

	it("carries the in-flight message's tool call ids for dedup", () => {
		const live = {
			...liveBase(),
			streamingMessage: {
				role: "assistant",
				content: [{ type: "tool_use", id: "call-77", name: "edit" }],
			},
		} as SessionLive;
		expect(snapshotFromLive(live, NOW)?.toolIds).toEqual(["call-77"]);
	});
});

describe("snapshot storage", () => {
	it("round-trips save/load/clear", () => {
		const snap = snapshotFromLive(
			{ ...liveBase(), streamingMessage: textMsg("半句") } as SessionLive,
			NOW,
		);
		expect(snap).not.toBeNull();
		saveSnapshot("s1", snap!);
		expect(loadSnapshot("s1")?.answerText).toBe("半句");
		clearSnapshot("s1");
		expect(loadSnapshot("s1")).toBeNull();
	});

	it("degrades silently when storage write or read throws", () => {
		const snap = snapshotFromLive(
			{ ...liveBase(), streamingMessage: textMsg("半句") } as SessionLive,
			NOW,
		)!;
		localStorage.setItem = () => {
			throw new Error("full");
		};
		expect(() => saveSnapshot("s1", snap)).not.toThrow();
		localStorage.getItem = () => {
			throw new Error("unreadable");
		};
		expect(loadSnapshot("s1")).toBeNull();
	});

	it("keeps only the newest snapshots beyond the session cap", () => {
		for (let i = 0; i < 25; i++) {
			const snap = snapshotFromLive(
				{ ...liveBase(), streamingMessage: textMsg(`answer ${i}`) } as SessionLive,
				NOW + i,
			)!;
			saveSnapshot(`s${i}`, snap);
		}
		expect(loadSnapshot("s24")?.answerText).toBe("answer 24");
		expect(loadSnapshot("s0")).toBeNull();
		expect(loadSnapshot("s5")?.answerText).toBe("answer 5");
	});
});

const item = (over: Partial<TranscriptItem>): TranscriptItem => ({
	id: "t1",
	parentId: null,
	ts: new Date(NOW).toISOString(),
	kind: "assistant",
	text: null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
	...over,
});

describe("snapshotInItems (dedup against the transcript)", () => {
	it("matches a transcript item that continues the saved text", () => {
		const snap = { answerText: "这一段回答写到一半被打断了，后面还有很长的内容", toolIds: [] };
		const items = [
			item({ text: "这一段回答写到一半被打断了，后面还有很长的内容，后来补完了" }),
		];
		expect(snapshotInItems(snap, items)).toBe(true);
	});

	it("does not match unrelated content", () => {
		const snap = { answerText: "这一段回答写到一半被打断了，后面还有很长的内容", toolIds: [] };
		expect(snapshotInItems(snap, [item({ text: "完全无关的另一条回答" })])).toBe(false);
	});

	it("short saved text requires an exact match", () => {
		const snap = { answerText: "好的", toolIds: [] };
		expect(snapshotInItems(snap, [item({ text: "好的，接下来我们继续" })])).toBe(false);
		expect(snapshotInItems(snap, [item({ text: "好的" })])).toBe(true);
	});

	it("falls back to tool call ids only when the message had no text", () => {
		const snap = { answerText: "", toolIds: ["call-77"] };
		expect(
			snapshotInItems(snap, [item({ toolCalls: [{ id: "call-77", name: "edit", args: {}, intent: null }] })]),
		).toBe(true);
		const withText = { answerText: "这一段回答写到一半被打断了，后面还有很长的内容", toolIds: ["call-77"] };
		expect(
			snapshotInItems(withText, [item({ toolCalls: [{ id: "call-77", name: "edit", args: {}, intent: null }] })]),
		).toBe(false);
	});

	it("uses exact completion identity even when the transcript entry has a later timestamp", () => {
		const text = "A response that has now completed and been committed.";
		const snap = { answerText: text, toolIds: [], streamingMessage: {
			role: "assistant", content: [], timestamp: NOW - 1000, completedAt: NOW,
		} };
		expect(snapshotInItems(snap, [item({ text, ts: new Date(NOW + 1000).toISOString(), completedAt: NOW })], true)).toBe(true);
		expect(snapshotInItems(snap, [item({ text, completedAt: NOW + 1 })], true)).toBe(false);
	});

	it("does not use an eighty-character opening as proof that a longer active reply is committed", () => {
		const opening = "This is a shared introductory sentence in two distinct responses. ".repeat(2);
		const snap = { answerText: `${opening}The current response continues differently.`, toolIds: [], streamingMessage: {
			role: "assistant", content: [], timestamp: NOW,
		} };
		expect(snapshotInItems(snap, [item({ text: `${opening}The previous response ended here.` })], true)).toBe(false);
	});

	it.each([false, true])("a shorter persisted prefix cannot consume the retained suffix (active=%s)", (active) => {
		const prefix = "The response opening is shared. ".repeat(4);
		const snap = { answerText: `${prefix}Only the retained snapshot contains this ending.`, toolIds: ["tool-1"], streamingMessage: {
			role: "assistant", content: [], timestamp: NOW - 1000, completedAt: NOW,
		} };
		const partial = item({ text: prefix, completedAt: NOW, toolCalls: [{ id: "tool-1", name: "read", args: {}, intent: null }] });
		expect(snapshotInItems(snap, [partial], active)).toBe(false);
		expect(snapshotInItems(snap, [{ ...partial, text: `${snap.answerText} Now complete.` }], active)).toBe(true);
	});

	it("an older equal answer does not consume a later interrupted reply", () => {
		const text = "This exact response was repeated in a later turn.";
		const snap = { answerText: text, toolIds: [], streamingMessage: { ...textMsg(text), timestamp: NOW } };
		expect(snapshotInItems(snap, [item({ text, ts: new Date(NOW - 1000).toISOString() })])).toBe(false);
		expect(snapshotInItems(snap, [item({ text, completedAt: NOW + 1000 })])).toBe(true);
	});
});

describe("snapshotContinues / mergeSnapshotIntoLive (live reattach)", () => {
	const snap = {
		answerText: "第一段已完成，第二段正在",
		liveRequests: [
			{ id: "r1", toolCallIds: [], hasText: true, parts: [], stat: { startedAt: null, completedAt: null, durationMs: null, ttftMs: null, usage: null, error: null } },
		],
		tools: {
			c1: { toolCallId: "c1", toolName: "bash", args: {}, intent: null, status: "done", text: "", details: null },
		},
		turnStartedAt: 111,
		thinkingStartedAt: 222,
		thinkingEndedAt: 333,
		thinkingDurations: { m1: { startedAt: 222, endedAt: 333 } },
	};

	it("detects a continuation of the same answer", () => {
		expect(snapshotContinues(snap, textMsg("第一段已完成，第二段正在写"))).toBe(true);
		expect(snapshotContinues(snap, textMsg("完全不同的新回答"))).toBe(false);
	});

	it("merges without duplicating known requests and keeps live tools ahead", () => {
		const live: SessionLive = {
			...liveBase(),
			liveRequests: [
				{ id: "r1", toolCallIds: [], hasText: true, parts: [], stat: { startedAt: null, completedAt: null, durationMs: null, ttftMs: null, usage: null, error: null } },
				{ id: "r2", toolCallIds: [], hasText: true, parts: [], stat: { startedAt: null, completedAt: null, durationMs: null, ttftMs: null, usage: null, error: null } },
			],
			tools: {
				c1: { toolCallId: "c1", toolName: "bash", args: {}, intent: null, status: "error", text: "new", details: null },
			},
		};
		const patch = mergeSnapshotIntoLive(live, snap as never);
		expect(patch.liveRequests?.map((r) => r.id)).toEqual(["r1", "r2"]);
		expect(patch.tools?.c1.status).toBe("error");
		expect(patch.turnStartedAt).toBe(111);
	});

	it("fills thinking and timing gaps from the snapshot", () => {
		const patch = mergeSnapshotIntoLive(liveBase(), snap as never);
		expect(patch.turnStartedAt).toBe(111);
		expect(patch.thinkingStartedAt).toBe(222);
		expect(patch.thinkingEndedAt).toBe(333);
		expect(patch.thinkingDurations?.m1).toEqual({ startedAt: 222, endedAt: 333 });
		expect(patch.liveRequests?.map((r) => r.id)).toEqual(["r1"]);
	});
});

describe("unfinishedDisplay", () => {
	it("shows only the lost in-flight part, not completed requests", () => {
		const snap = {
			savedAt: NOW,
			liveRequests: [{ id: "r1", toolCallIds: [], hasText: true, parts: [], stat: {} }],
			streamingMessage: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "想一想" },
					{ type: "text", text: "半句回答" },
					{ type: "tool_use", id: "call-9", name: "edit" },
				],
			},
			tools: {
				"call-9x": { toolCallId: "call-9x", toolName: "bash", args: {}, intent: null, status: "running", text: "", details: null },
			},
		};
		const display = unfinishedDisplay(snap as never);
		expect(display.text).toBe("半句回答");
		expect(display.thinking).toEqual(["想一想"]);
		expect(display.tools.map((t) => ({ id: t.id, running: t.running }))).toEqual([
			{ id: "call-9", running: false },
			{ id: "call-9x", running: true },
		]);
	});
});
