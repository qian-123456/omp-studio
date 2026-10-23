import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { type CommandOutputEntry, makeUserEcho, type UserEcho, useLive } from "../../stores/live";
import { isLocalRowItem, parseLocalRows, serializeLocalRows, withLocalRows } from "./localRows";
import { groupTurnBlocks } from "./turnGrouping";

const T0 = Date.parse("2026-10-20T09:40:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();

const item = (id: string, kind: TranscriptItem["kind"], ms: number, text = id): TranscriptItem => ({
	id,
	parentId: null,
	ts: iso(ms),
	kind,
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

const output = (id: number, ms: number, anchorId: string | null): CommandOutputEntry => ({
	id,
	command: "shake",
	text: "Dropped 32 thinking blocks",
	ts: T0 + ms,
	kind: "omp",
	anchorId,
});

const echo = (text: string, ms: number, anchorId: string | null): UserEcho => ({
	...makeUserEcho(text),
	ts: iso(ms),
	anchorId,
});

describe("withLocalRows", () => {
	const items = [item("u1", "user", 0), item("a1", "assistant", 1_000), item("a2", "assistant", 30 * 60_000)];

	it("places a row after its anchor, before later assistant items", () => {
		const out = withLocalRows(items, [echo("/shake thinking", 2_000, "a1")], [output(1, 3_000, "a1")]);
		expect(out.map((i) => (isLocalRowItem(i) ? i.localRow.type : i.id))).toEqual([
			"u1",
			"a1",
			"echo",
			"output",
			"a2",
		]);
	});

	it("falls back to send time when the anchor is unknown or null", () => {
		const out = withLocalRows(items, [], [output(1, 5_000, "gone"), output(2, 6_000, null)]);
		expect(out.map((i) => i.id)).toEqual(["u1", "a1", "local-output-1", "local-output-2", "a2"]);
	});

	it("keeps send-time order inside one slot", () => {
		const out = withLocalRows(items, [], [output(2, 9_000, "u1"), output(1, 4_000, "u1")]);
		expect(out.map((i) => i.id).slice(1, 3)).toEqual(["local-output-1", "local-output-2"]);
	});

	it("drops an echo the transcript already carries", () => {
		const withUser = [...items, item("u2", "user", 31 * 60_000, "/fast on")];
		const out = withLocalRows(withUser, [echo("/fast on", 31 * 60_000 - 500, "a2")], []);
		expect(out).toBe(withUser);
	});

	it("a row created mid-turn splits the turn so later output groups below it", () => {
		const out = withLocalRows(items, [], [output(1, 3_000, "a1")]);
		const blocks = groupTurnBlocks(out);
		expect(blocks.map((b) => b.type)).toEqual(["turn", "protocol", "turn"]);
		const last = blocks[2];
		expect(last.type === "turn" && last.answerItem?.id).toBe("a2");
	});
});

describe("persistence", () => {
	it("round-trips settled rows and skips running ones", () => {
		const rows = serializeLocalRows(
			[echo("/shake thinking", 100, "a1")],
			[output(1, 200, "a1"), { ...output(2, 300, "a1"), status: "running" }],
			[],
		);
		expect(rows.map((r) => r.t)).toEqual(["echo", "output"]);
		expect(parseLocalRows(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
	});

	it("drops malformed rows", () => {
		expect(parseLocalRows([{ t: "output" }, null, { t: "echo", id: 1 }])).toEqual([]);
		expect(parseLocalRows({})).toEqual([]);
	});
});

const SID = "lr-s";
const rpcGet = vi.fn();
const rpcSet = vi.fn();
vi.mock("../../lib/ipc", () => ({
	localRowsGet: (...a: unknown[]) => rpcGet(...a),
	localRowsSet: (...a: unknown[]) => rpcSet(...a),
	rpcSend: vi.fn(),
}));

describe("live store local rows", () => {
	beforeEach(() => {
		useLive.setState({ sessions: {} });
		rpcGet.mockReset().mockResolvedValue([]);
		rpcSet.mockReset().mockResolvedValue(undefined);
	});

	it("moves a handled command's echo out of pendingUserEchoes, anchored", () => {
		const live = useLive.getState();
		live.setItems(SID, [item("a1", "assistant", 0)], 10);
		live.noteCommandSent(SID, "shake");
		live.addUserEcho(SID, "/shake thinking");
		live.addUserEcho(SID, "plain prompt");
		useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "command_output", text: "Dropped 32" } });
		const s = useLive.getState().sessions[SID];
		expect(s.pendingUserEchoes.map((e) => e.text)).toEqual(["plain prompt"]);
		expect(s.localEchoes?.map((e) => e.text)).toEqual(["/shake thinking"]);
		expect(s.localEchoes?.[0].anchorId).toBe("a1");
		expect(s.commandOutputs[0].anchorId).toBe("a1");
	});

	it("an agent-invoked command keeps its echo pending", () => {
		const live = useLive.getState();
		live.noteCommandSent(SID, "review");
		live.addUserEcho(SID, "/review");
		useLive.getState().reduceFrame({
			sessionId: SID,
			frame: { type: "response", command: "prompt", success: true, data: { agentInvoked: true } },
		});
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toHaveLength(1);
		expect(useLive.getState().sessions[SID].localEchoes ?? []).toHaveLength(0);
	});

	it("hydrates stored rows before the new ones and saves after a change", async () => {
		const sid = "lr-hydrate";
		rpcGet.mockResolvedValue([
			{ t: "output", ts: T0, anchorId: "a1", command: "shake", text: "old card", kind: "omp" },
		]);
		useLive.getState().hydrateLocalRows(sid);
		await vi.waitFor(() => expect(useLive.getState().sessions[sid]?.localRowsLoaded).toBe(true));
		expect(useLive.getState().sessions[sid].commandOutputs.map((o) => o.text)).toEqual(["old card"]);
		vi.useFakeTimers();
		useLive.getState().addCommandOutput(sid, "status", "新的卡片");
		await vi.advanceTimersByTimeAsync(500);
		vi.useRealTimers();
		await vi.waitFor(() => expect(rpcSet).toHaveBeenCalledTimes(1));
		const saved = rpcSet.mock.calls[0][1] as { text: string }[];
		expect(saved.map((r) => r.text)).toEqual(["old card", "新的卡片"]);
	});

	it("a failed read never overwrites stored rows", async () => {
		const sid = "lr-failed-read";
		rpcGet.mockRejectedValue(new Error("unknown command"));
		useLive.getState().hydrateLocalRows(sid);
		await vi.waitFor(() => expect(useLive.getState().sessions[sid]?.localRowsLoaded).toBe(true));
		vi.useFakeTimers();
		useLive.getState().addCommandOutput(sid, "status", "card");
		await vi.advanceTimersByTimeAsync(500);
		vi.useRealTimers();
		expect(rpcSet).not.toHaveBeenCalled();
	});
});
