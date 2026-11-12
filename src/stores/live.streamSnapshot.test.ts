/**
 * Regression tests for the retained half-answer (未完成半句恢复):
 * restore into a still-streaming session, restore as an "未完成回答" row with
 * transcript dedup, and silent degradation when storage fails.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../lib/contracts";
import { pruneRemovedSessions, setExitIntent, useLive, type SessionLive } from "./live";
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
			streamingMessage: { role: "assistant", timestamp: savedAt, content: [{ type: "text", text }] },
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

describe("process exit during a turn", () => {
	const proc = (sessionId: string, running: boolean) =>
		useLive.getState().reduceProcess({ sessionId, running, exitCode: running ? null : 1 });

	it("retains even an unthrottled partial answer and explains the unknown disconnect until a new run", () => {
		const sid = "disconnect-partial";
		proc(sid, true);
		frame(sid, { type: "agent_start" });
		frame(sid, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial output" }] } });
		proc(sid, false);
		expect(useLive.getState().sessions[sid].interruption).toBe("disconnected");
		expect(useLive.getState().sessions[sid].restoredUnfinished?.answerText).toBe("partial output");
		expect(loadSnapshot(sid)?.answerText).toBe("partial output");
		expect(useLive.getState().sessions[sid].streaming).toBe(false);
		proc(sid, true);
		expect(useLive.getState().sessions[sid].interruption).toBe("disconnected");
		frame(sid, { type: "agent_start" });
		expect(useLive.getState().sessions[sid].interruption).toBeUndefined();
	});

	it("does not warn for an idle exit or a completed explicit stop", () => {
		const sid = "disconnect-idle";
		proc(sid, true);
		proc(sid, false);
		expect(useLive.getState().sessions[sid].interruption).toBeUndefined();
		proc(sid, true);
		frame(sid, { type: "agent_start" });
		setExitIntent(sid, "stop");
		frame(sid, { type: "agent_end", isTerminal: true, aborted: true });
		proc(sid, false);
		expect(useLive.getState().sessions[sid].interruption).toBeUndefined();
	});

	it.each(["stop", "restart"] as const)("identifies a process exit during an explicit %s", (intent) => {
		const sid = `disconnect-${intent}`;
		proc(sid, true);
		frame(sid, { type: "agent_start" });
		setExitIntent(sid, intent);
		proc(sid, false);
		expect(useLive.getState().sessions[sid].interruption).toBe(intent);
	});
});

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
		expect(live.streamingMessage?.content).toEqual([{ type: "text", text: "第一段已完成，第二段正在" }]);
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

	it("does not seed a completed old answer under a newer running request", () => {
		const SID = "restore-streaming-committed-old";
		const text = "A completed historical answer must not become the current response again.";
		saveSnapshot(SID, snapOf(text));
		useLive.setState((s) => ({
			sessions: {
				...s.sessions,
				[SID]: { ...empty(), streaming: true, items: [item("old-answer", text)] },
			},
		}));
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].streamingMessage).toBeNull();
		frame(SID, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "The current answer remains visible." }] },
		});
		expect(useLive.getState().sessions[SID].streamingMessage?.content).toEqual([
			{ type: "text", text: "The current answer remains visible." },
		]);
	});

	it("removes only seeded prose when the transcript arrives after hydration", () => {
		const SID = "restore-delayed-transcript";
		const text = "This saved response has already finished before the view was reopened.";
		saveSnapshot(SID, snapOf(text));
		useLive.setState({ sessions: { [SID]: { ...empty(), streaming: true } } });
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].streamingMessage?.content).toEqual([{ type: "text", text }]);
		frame(SID, { type: "tool_execution_start", toolCallId: "current-tool", toolName: "read", args: {} });
		useLive.getState().setItems(SID, [item("committed-old", text)], 10);
		const live = useLive.getState().sessions[SID];
		expect(live.streamingMessage).toBeNull();
		expect(live.tools["current-tool"].status).toBe("running");
	});

	it("preserves a newer response while clearing a committed saved response", () => {
		const SID = "restore-newer-frame";
		const text = "The historical saved response is committed.";
		saveSnapshot(SID, snapOf(text));
		useLive.setState({ sessions: { [SID]: { ...empty(), streaming: true } } });
		useLive.getState().hydrateStreamSnapshot(SID);
		frame(SID, {
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "A different current response" }] },
		});
		useLive.getState().setItems(SID, [item("committed-old", text)], 10);
		expect(useLive.getState().sessions[SID].streamingMessage?.content).toEqual([
			{ type: "text", text: "A different current response" },
		]);
	});

	it("retains a new unfinished response that repeats an earlier answer's opening", () => {
		const SID = "restore-repeated-opening";
		const text = "I will inspect the requested files before making changes.";
		saveSnapshot(SID, snapOf(text));
		useLive.setState({ sessions: {
			[SID]: { ...empty(), streaming: true, items: [{
				...item("earlier-answer", `${text} These were the previous findings.`),
				ts: new Date(NOW - 1000).toISOString(),
			}] },
		} });
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].streamingMessage?.content).toEqual([{ type: "text", text }]);
	});

	it("retains active prose when its saved message has no timestamp to establish chronology", () => {
		const SID = "restore-missing-message-time";
		const text = "A repeated response cannot be identified by its opening alone.";
		const snap = snapOf(text);
		snap.streamingMessage!.timestamp = undefined;
		saveSnapshot(SID, snap);
		useLive.setState({ sessions: {
			[SID]: { ...empty(), streaming: true, items: [item("earlier-answer", text)] },
		} });
		useLive.getState().hydrateStreamSnapshot(SID);
		expect(useLive.getState().sessions[SID].streamingMessage?.content).toEqual([{ type: "text", text }]);
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

	it("keeps the retained suffix until a transcript row carries every saved word", () => {
		const sid = "restore-incomplete-prefix";
		const opening = "A shared response introduction that is long enough to match. ".repeat(3);
		const full = `${opening}The ending survived only in retention.`;
		saveSnapshot(sid, snapOf(full));
		useLive.setState((s) => ({ sessions: { ...s.sessions, [sid]: { ...empty(), items: [item("partial", opening)] } } }));
		useLive.getState().hydrateStreamSnapshot(sid);
		expect(useLive.getState().sessions[sid].restoredUnfinished?.answerText).toBe(full);
		expect(loadSnapshot(sid)?.answerText).toBe(full);
		useLive.getState().setItems(sid, [item("complete", full)], 20);
		expect(useLive.getState().sessions[sid].restoredUnfinished ?? null).toBeNull();
		expect(loadSnapshot(sid)).toBeNull();
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

	it("evicts a left session's transcript and subagents once its process finishes", async () => {
		const { holdTranscript } = await import("./live");
		const { useSessions } = await import("./sessions");
		const ids = ["evict-busy", "evict-idle-1", "evict-idle-2", "evict-idle-3"];
		useSessions.setState({
			sessions: Object.fromEntries(
				ids.map((id) => [id, { id, file: `/tmp/${id}.jsonl` } as never]),
			),
		});
		useLive.setState((s) => ({
			sessions: {
				...s.sessions,
				"evict-busy": {
					...empty(),
					alive: true,
					items: [item("m0", "busy transcript")],
					subagents: {
						sub1: {
							toolCallId: "sub1",
							agent: "task",
							label: "sub1",
							assignment: "work",
							description: null,
							status: "done",
							model: null,
							thinkingText: "",
							answerText: "subagent output",
							tools: [],
							tokens: null,
							durationMs: 10,
							error: null,
						} as never,
					},
				},
				"evict-idle-1": { ...empty(), alive: false, items: [item("m1", "idle 1")] },
				"evict-idle-2": { ...empty(), alive: false, items: [item("m2", "idle 2")] },
				"evict-idle-3": { ...empty(), alive: false, items: [item("m3", "idle 3")] },
			},
		}));
		for (const id of ids) {
			const release = holdTranscript(id);
			release();
		}
		await new Promise((r) => setTimeout(r, 10));
		// While evict-busy is still alive, its items are kept.
		expect(useLive.getState().sessions["evict-busy"].items).toHaveLength(1);
		// Once its process exits and a 4th idle transcript accumulates, it is evicted.
		useLive.getState().reduceProcess({ sessionId: "evict-busy", running: false, exitCode: 0 });
		await new Promise((r) => setTimeout(r, 10));
		expect(useLive.getState().sessions["evict-busy"].items).toHaveLength(0);
		expect(useLive.getState().sessions["evict-busy"].subagents).toEqual({});
	});
});
