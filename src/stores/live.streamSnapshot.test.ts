/**
 * Regression tests for the retained half-answer (未完成半句恢复):
 * restore into a still-streaming session, restore as an "未完成回答" row with
 * transcript dedup, and silent degradation when storage fails.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../lib/contracts";
import { pruneRemovedSessions, useLive, type SessionLive } from "./live";
import {
	clearSnapshot,
	loadSnapshot,
	saveSnapshot,
	snapshotFromLive,
	type StreamSnapshot,
} from "../features/chat/streamSnapshot";

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
	useLive.setState({ sessions: {} });
});

const NOW = 1_700_000_000_000;

const snapOf = (text: string, savedAt = NOW): StreamSnapshot =>
	snapshotFromLive(
		{
			...empty(),
			streaming: true,
			streamingMessage: { role: "assistant", content: [{ type: "text", text }] },
		} as SessionLive,
		savedAt,
	)!;

const empty = (): SessionLive => ({
	streaming: false,
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

const item = (id: string, text: string): TranscriptItem => ({
	id,
	parentId: null,
	ts: new Date(NOW).toISOString(),
	kind: "assistant",
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

const frame = (sessionId: string, f: Record<string, unknown>) =>
	useLive.getState().reduceFrame({ sessionId, frame: f });

describe("restore while the session is still streaming", () => {
	it("merges the snapshot into the live state and lets frames take over", () => {
		const SID = "restore-streaming";
		saveSnapshot(SID, snapOf("第一段已完成，第二段正在"));
		useLive.setState((s) => ({
			sessions: {
				...s.sessions,
				[SID]: { ...empty(), streaming: true, turnStartedAt: null },
			},
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		const live = useLive.getState().sessions[SID];
		// No live rows existed: the snapshot fills the gap (streamingMessage
		// itself is the same source the frames overwrite, requests/tools fill).
		expect(live.streaming).toBe(true);
		expect(live.restoredUnfinished ?? null).toBeNull();
		// A frame for the same answer confirms and keeps flowing; the turn end
		// then clears the retention (content committed).
		frame(SID, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "第一段已完成，第二段正在写" }] },
		});
		expect(useLive.getState().sessions[SID].streamingMessage).not.toBeNull();
		frame(SID, { type: "agent_end", isTerminal: true, messages: [] });
		expect(loadSnapshot(SID)).toBeNull();
	});

	it("hydrates only once per session", () => {
		const SID = "restore-streaming-once";
		saveSnapshot(SID, snapOf("第一段已完成，第二段正在"));
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: { ...empty(), streaming: true } },
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		// Turn continues, live rows already present — a second hydrate must not
		// re-apply the older snapshot over newer live state.
		frame(SID, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "新的内容" }] },
		});
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].liveRequests.length).toBe(0);
	});
});

describe("restore as an unfinished row when the backend is idle", () => {
	it("restores the row, then dedupes it once the transcript carries the content", () => {
		const SID = "restore-unfinished";
		const text = "这一段回答写到一半应用就重启了，后半句已经丢失";
		saveSnapshot(SID, snapOf(text));
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: { ...empty(), streaming: false } },
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].restoredUnfinished?.answerText).toBe(text);

		// The transcript lands without the content: the row stays.
		useLive.getState().setItems(SID, [item("t0", "更早的一条完整回答")], 10);
		expect(useLive.getState().sessions[SID].restoredUnfinished?.answerText).toBe(text);

		// A later page carries the same content: dedupe and drop the retention.
		useLive.getState().setItems(SID, [item("t1", `${text}（其实已经写完落盘了）`)], 20);
		expect(useLive.getState().sessions[SID].restoredUnfinished ?? null).toBeNull();
		expect(loadSnapshot(SID)).toBeNull();
	});

	it("does not restore when the transcript already has the content", () => {
		const SID = "restore-dedup-early";
		const text = "这一段回答其实在退出前已经写完并落盘了";
		saveSnapshot(SID, snapOf(text));
		useLive.setState((s) => ({
			sessions: {
				...s.sessions,
				[SID]: { ...empty(), items: [item("t0", `${text}，完整版`)] },
			},
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].restoredUnfinished ?? null).toBeNull();
		expect(loadSnapshot(SID)).toBeNull();
	});

	it("one-click remove clears the row and the retention", () => {
		const SID = "restore-remove";
		saveSnapshot(SID, snapOf("这段回答永远不会出现在 transcript 里了"));
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: empty() },
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].restoredUnfinished).not.toBeNull();
		useLive.getState().removeUnfinishedAnswer(SID);
		expect(useLive.getState().sessions[SID].restoredUnfinished ?? null).toBeNull();
		expect(loadSnapshot(SID)).toBeNull();
	});
});

describe("retention lifecycle", () => {
	it("clears the snapshot when the turn ends normally", () => {
		const SID = "retention-normal-end";
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: { ...empty(), streaming: true } },
		}));
		saveSnapshot(SID, snapOf("正在生成的回答，稍后会正常完成", NOW));
		frame(SID, { type: "agent_end", isTerminal: true, messages: [] });
		expect(loadSnapshot(SID)).toBeNull();
	});

	it("keeps the snapshot when the process died (crash / restart)", () => {
		const SID = "retention-process-exit";
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: { ...empty(), streaming: true } },
		}));
		saveSnapshot(SID, snapOf("进程崩溃前正在生成的半句", NOW));
		useLive.getState().reduceProcess({ sessionId: SID, running: false, exitCode: 1 });
		expect(loadSnapshot(SID)?.answerText).toBe("进程崩溃前正在生成的半句");
	});

	it("degrades silently when storage read fails at hydrate time", () => {
		const SID = "retention-storage-error";
		localStorage.getItem = () => {
			throw new Error("blocked");
		};
		expect(() => useLive.getState().hydrateStreamSnapshot(SID)).not.toThrow();
		expect(useLive.getState().sessions[SID]?.restoredUnfinished ?? null).toBeNull();
	});

	it("removes the retention together with its session", () => {
		const SID = "retention-session-removed";
		saveSnapshot(SID, snapOf("会话被删除时的半句", NOW));
		pruneRemovedSessions([SID]);
		expect(loadSnapshot(SID)).toBeNull();
	});

	it("clears storage so a snapshot never survives alongside a finished turn", () => {
		const SID = "retention-clear-helper";
		saveSnapshot(SID, snapOf("待清理", NOW));
		clearSnapshot(SID);
		expect(loadSnapshot(SID)).toBeNull();
	});
});
