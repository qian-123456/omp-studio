// @vitest-environment jsdom
/**
 * Controller-level tests driving the real ChatController with a mocked `api`/`ui` and the real SSE bus.
 * - M3 (fixed): no in-turn "text collapse" — a finished segment is retained until the persisted row
 *   takes over, the next segment streams into a fresh live row, and the turn-end cleanup only removes
 *   what that terminal actually left behind (a fast new segment survives the landing fetch).
 * - M4 (fixed): `send()` must only guard `delivery.phase === "unknown"`; an in-flight
 *   `"sending"` dispatch must not be reported as 「送达状态待确认」.
 * - Resync (fixed): SSE reconnect / visibility return / refresh keep the half-streamed live row;
 *   a row the composer proves stale becomes a marked interrupted answer instead of being wiped.
 * - 断流续传 (fixed): a half answer mirrored before the page died is restored — as the live row
 *   when the backend is still streaming, as a marked interrupted row when it is not; storage
 *   failures never break streaming.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptPage } from "../../core/types";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import { ChatController } from "./chatStore";
import { LIVE_SNAPSHOT_KEY, loadLiveEntry, saveLiveMain } from "./lib/liveSnapshot";
import { loadUnsent, saveUnsent } from "./lib/unsent";
import { nav } from "../../core/nav";

const ID = "sess-m3m4";

const { toastMock, confirmMock } = vi.hoisted(() => ({ toastMock: vi.fn(), confirmMock: vi.fn() }));
vi.mock("../../ui", () => ({ toast: toastMock, confirm: confirmMock }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../core/api", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../../core/api")>();
	return { ...orig, api: apiMock, upload: vi.fn() };
});

const GUARD_TOAST = "上一条消息送达状态待确认，请先核对记录或恢复输入，勿直接重发";

/* ------------------------------------------------------------------ fixtures */

let transcriptPages: TranscriptPage[];
let composerState: Record<string, unknown>;
let promptExImpl: () => Promise<unknown>;
let promptExCalls: number;

function deferred<T>() {
	// Match the phone's ES2021 library target, which lacks Promise.withResolvers.
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function routeApi(method: string, path: string): unknown {
	const [base] = path.split("?");
	if (method === "GET" && base === "/sessions") return Promise.resolve(Object.values(useSessions.getState().byId));
	if (base === `/sessions/${ID}/transcript`) {
		return transcriptPages.length ? transcriptPages.shift() : { items: [], nextOffset: 0, tailId: null };
	}
	if (base === `/sessions/${ID}/composer-state`) return composerState;
	if (base === `/sessions/${ID}/pending-ui`) return [];
	if (base === `/sessions/${ID}/slash-commands`) return [];
	if (base === `/sessions/${ID}/prompt-ex`) {
		promptExCalls++;
		return promptExImpl();
	}
	throw new Error(`unexpected api call: ${method} ${path}`);
}

/** One animation-frame flush + microtasks (jsdom rAF ≈ 16 ms real time). */
const rafTick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));
/** Enough real time for the 250 ms debounced fetch to fire and land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 420));

const rpc = (frame: Record<string, unknown>): void => events.emit("rpc", { sessionId: ID, frame } as never);
const textFrame = (text: string): Record<string, unknown> => ({
	type: "message_update",
	message: { role: "assistant", content: [{ type: "text", text }] },
});

function makeController(): ChatController {
	const c = new ChatController(ID);
	c.start();
	return c;
}

beforeEach(() => {
	localStorage.clear();
	toastMock.mockClear();
	confirmMock.mockClear();
	transcriptPages = [];
	composerState = {};
	promptExImpl = async () => ({ sessionId: ID });
	promptExCalls = 0;
	apiMock.mockImplementation(async (method: string, path: string) => routeApi(method, path));
	useSessions.setState({
		byId: {
			[ID]: {
				id: ID,
				label: ID,
				title: ID,
				status: "idle",
				updatedAt: new Date().toISOString(),
				cwd: "/tmp/omp",
				live: false,
				pending: null,
			},
		},
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ M3 */

describe("M3: in-turn segment retention at message boundaries (fixed)", () => {
	it("message_end retains A as a completed segment; the next message streams into a fresh live row without collapsing A", async () => {
		const A = "这是上一条消息已经完整流出的长文本，用户正读到这里。".repeat(6);
		const c = makeController();
		await rafTick();
		expect(c.state.loaded).toBe(true);

		await c.send("你好", "followUp");
		await rafTick();
		expect(promptExCalls).toBe(1);
		expect(c.state.delivery).toBeNull();

		rpc({ type: "agent_start" });
		await rafTick();
		expect(c.state.working).toBe(true);

		rpc(textFrame(A));
		await rafTick();
		expect(c.state.live?.text).toBe(A);

		rpc({ type: "message_end" });
		await rafTick();
		// message_end 后旧段保留为已完成段落：A 仍然可见，live 行清空等待下一段
		expect(c.state.live).toBeNull();
		expect(c.state.segments.map((s) => s.text)).toEqual([A]);
		expect(c.state.transcript.items.some((i) => i.text === A)).toBe(false);

		// <250ms：下一条消息的第一个 message_update 落进全新的 live 行，A 不被整体替换
		const B0 = "你";
		rpc(textFrame(B0));
		await rafTick();
		expect(c.state.live?.text).toBe(B0);
		expect(c.state.segments.map((s) => s.text)).toEqual([A]);

		// 防抖拉取落地：A 以持久行接替（segment 移除），正在流式的 B0 不受影响
		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
				],
				nextOffset: 2,
			},
		];
		await settle();
		expect(c.state.transcript.items.some((i) => i.text === A)).toBe(true);
		expect(c.state.segments).toEqual([]);
		expect(c.state.live?.text).toBe(B0);

		// 恢复：下一条 message_update 继续正常流式
		rpc(textFrame("你好，世界"));
		await rafTick();
		expect(c.state.live?.text).toBe("你好，世界");
		c.dispose();
	});

	it("second half (task sequence): message_end → fetch lands → message_update(B): B survives later fetches", async () => {
		const A = "上一条消息的文本。".repeat(8);
		const c = makeController();
		await rafTick();
		await c.send("你好", "followUp");
		await rafTick();

		rpc({ type: "agent_start" });
		rpc(textFrame(A));
		rpc({ type: "message_end" });
		await rafTick();
		expect(c.state.segments.map((s) => s.text)).toEqual([A]);

		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
				],
				nextOffset: 2,
			},
		];
		await settle();
		// fetch 先落地：A 已持久化，segment 被持久行接替，live 行清空
		expect(c.state.transcript.items.some((i) => i.text === A)).toBe(true);
		expect(c.state.segments).toEqual([]);
		expect(c.state.live).toBeNull();

		const B = "新的一条消息开始流式输出";
		rpc(textFrame(B));
		await rafTick();
		expect(c.state.live?.text).toBe(B);

		// 之后的再次拉取（无收场遗留）不会把 B 清掉
		events.emit("touch", { sessionId: ID } as never);
		await settle();
		expect(c.state.live?.text).toBe(B);
		c.dispose();
	});

	it("terminal agent_end leaves only its own row behind: a new message streaming before the fetch lands survives it", async () => {
		const A = "回合末尾的回复文本。".repeat(8);
		const c = makeController();
		await rafTick();
		await c.send("你好", "followUp");
		await rafTick();

		rpc({ type: "agent_start" });
		rpc(textFrame(A));
		// 回合真正结束（omp 实际帧序：message_end 之后还有 agent_end）
		rpc({ type: "agent_end" });
		await rafTick();
		// 收场遗留：A 以 segment 保留
		expect(c.state.live).toBeNull();
		expect(c.state.segments.map((s) => s.text)).toEqual([A]);

		// 新回合的第一条消息在拉取落地前已开始流出
		const B0 = "你";
		rpc(textFrame(B0));
		await rafTick();
		expect(c.state.live?.text).toBe(B0);

		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
				],
				nextOffset: 2,
			},
		];
		await settle();
		// 收场清理只清那次收场留下的 segment；新段已流出的 B0 不再被清掉一帧
		expect(c.state.transcript.items.some((i) => i.text === A)).toBe(true);
		expect(c.state.segments).toEqual([]);
		expect(c.state.live?.text).toBe(B0);

		// 下一条 message_update 继续正常流式
		rpc(textFrame("你好，世界"));
		await rafTick();
		expect(c.state.live?.text).toBe("你好，世界");
		c.dispose();
	});

	it("tools interleaved between segments: each message_end retains its own segment, tools keep their state", async () => {
		const A = "第一段的回答。".repeat(4);
		const B = "工具之后第二段的回答。".repeat(4);
		const c = makeController();
		await rafTick();
		await c.send("你好", "followUp");
		await rafTick();

		rpc({ type: "agent_start" });
		rpc(textFrame(A));
		rpc({ type: "message_end" });
		await rafTick();
		expect(c.state.segments.map((s) => s.text)).toEqual([A]);

		rpc({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
		rpc({ type: "tool_execution_end", toolCallId: "c1", result: { content: [{ type: "text", text: "ok" }] } });
		rpc(textFrame(B));
		await rafTick();
		expect(c.state.live?.text).toBe(B);
		expect(c.state.live?.tools.map((t) => t.id)).toEqual(["c1"]);

		rpc({ type: "message_end" });
		await rafTick();
		expect(c.state.segments.map((s) => s.text)).toEqual([A, B]);
		expect(c.state.segments[1].tools.map((t) => `${t.id}:${t.status}`)).toEqual(["c1:done"]);

		// 第一段先持久化：只移除它，B 继续等待自己的持久行
		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
				],
				nextOffset: 2,
			},
		];
		await settle();
		expect(c.state.transcript.items.some((i) => i.text === A)).toBe(true);
		expect(c.state.segments.map((s) => s.text)).toEqual([B]);

		// B 也持久化：segments 清空
		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
					{ id: "a2", kind: "assistant", text: B },
				],
				nextOffset: 3,
			},
		];
		events.emit("touch", { sessionId: ID } as never);
		await settle();
		expect(c.state.segments).toEqual([]);
		c.dispose();
	});

	it("rapid consecutive segments without tools: all retained, one fetch hands every one over, the still-streaming row survives", async () => {
		const A = "甲段。";
		const B = "乙段，紧跟着甲段结束。";
		const C = "丙段正在流式。";
		const c = makeController();
		await rafTick();
		await c.send("你好", "followUp");
		await rafTick();

		rpc({ type: "agent_start" });
		rpc(textFrame(A));
		rpc({ type: "message_end" });
		rpc(textFrame(B));
		rpc({ type: "message_end" });
		rpc(textFrame(C));
		await rafTick();
		// 两次 message_end 都在任何拉取落地之前：两段都保留，C 正常流式
		expect(c.state.segments.map((s) => s.text)).toEqual([A, B]);
		expect(c.state.live?.text).toBe(C);

		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: A },
					{ id: "a2", kind: "assistant", text: B },
				],
				nextOffset: 3,
			},
		];
		await settle();
		expect(c.state.segments).toEqual([]);
		expect(c.state.live?.text).toBe(C);
		c.dispose();
	});
});

/* ------------------------------------------------------------------ M4 */

describe("M4: send() delivery guard by phase", () => {
	it("phase 'sending' (double-tap while dispatch is in flight): second send is ignored, no guard toast, no double POST", async () => {
		let resolvePost!: (v: unknown) => void;
		promptExImpl = () => new Promise((r) => (resolvePost = r));
		const c = makeController();
		await rafTick();

		const first = c.send("第一条", "followUp");
		await rafTick();
		expect(c.state.delivery?.phase).toBe("sending");
		expect(promptExCalls).toBe(1);

		const second = await c.send("第二条", "followUp");
		expect(second).toBe(false);
		expect(promptExCalls).toBe(1);
		expect(toastMock).not.toHaveBeenCalledWith(GUARD_TOAST, { kind: "error" });
		// 第一次发送不受影响
		expect(c.state.delivery?.text).toBe("第一条");
		expect(c.state.delivery?.phase).toBe("sending");

		resolvePost({ sessionId: ID });
		await first;
		await rafTick();
		expect(c.state.delivery).toBeNull();
		c.dispose();
	});

	it("phase 'unknown': still intercepted with the original toast", async () => {
		promptExImpl = async () => {
			throw new Error("网络不可用");
		};
		const c = makeController();
		await rafTick();
		await c.send("可疑消息", "followUp");
		expect(c.state.delivery?.phase).toBe("unknown");
		toastMock.mockClear();

		const again = await c.send("可疑消息", "followUp");
		expect(again).toBe(false);
		expect(promptExCalls).toBe(1);
		expect(toastMock).toHaveBeenCalledWith(GUARD_TOAST, { kind: "error" });
		expect(c.state.delivery?.phase).toBe("unknown");
		c.dispose();
	});
});

/* ------------------------------------------------------------------ resync */

describe("ChatController resync", () => {
	it("keeps the half-streamed live row across resync/refresh and prunes it once the transcript persists it", async () => {
		composerState = { streaming: true };
		const messageTimestamp = Date.now();
		const c = makeController();
		await settle();
		await c.send("问题", "followUp");
		rpc({ type: "agent_start" });
		rpc({ type: "message_update", message: { role: "assistant", timestamp: messageTimestamp, content: [{ type: "text", text: "回答前半" }] } });
		await rafTick();
		expect(c.state.live?.text).toBe("回答前半");

		// SSE reconnects mid-message (hello → resync): the unpersisted half answer must stay on screen.
		events.emit("hello", {});
		await settle();
		expect(c.state.live?.text).toBe("回答前半");
		expect(c.state.working).toBe(true);

		// Pull-to-refresh while still streaming: keeps the live row too (nothing persisted yet).
		await c.refresh();
		expect(c.state.live?.text).toBe("回答前半");

		// message_end landed server-side during the gap; the fetched transcript carries the streamed text.
		transcriptPages = [
			{
				items: [{ id: "a1", kind: "assistant", text: "回答前半", ts: new Date(messageTimestamp).toISOString() }],
				nextOffset: 2048,
				tailId: "a1",
			},
		];
		await c.refresh();
		await rafTick();
		// The live copy was pruned (text cleared) instead of duplicated next to the persisted row.
		expect(c.state.live).toMatchObject({ text: "", thinking: "" });
		expect(c.state.transcript.items.map((i) => i.text)).toEqual(["回答前半"]);
		expect(c.state.working).toBe(true);
		c.dispose();
	});

	it("drops a stale live row on resync once the composer state proves the turn ended, keeping it as an interrupted answer", async () => {
		composerState = { streaming: false };
		transcriptPages = [
			{
				items: [
					{ id: "u0", kind: "user", text: "更早的问题", ts: "2026-10-31T09:59:00Z" },
					{ id: "a0", kind: "assistant", text: "更早的回答", ts: "2026-10-31T09:59:05Z" },
				],
				nextOffset: 1024,
				tailId: "a0",
			},
		];
		const c = makeController();
		await settle();

		// Frames streamed before the SSE died; the terminal end (agent_end) never arrived,
		// so the live row holds text that the transcript does not contain.
		rpc({ type: "agent_start" });
		rpc(textFrame("陈旧回答"));
		await rafTick();
		expect(c.state.live?.text).toBe("陈旧回答");
		expect(c.state.working).toBe(true);

		events.emit("hello", {});
		await settle();
		// Composer state says the turn is over and no frame refreshed the row since the resync:
		// the stale row leaves the live slot instead of contradicting the transcript —
		// and is not wiped but kept as a marked interrupted answer.
		expect(c.state.live).toBeNull();
		expect(c.state.working).toBe(false);
		expect(c.state.interrupted?.text).toBe("陈旧回答");
		expect(c.state.interrupted?.streaming).toBe(false);
		expect(c.state.transcript.items.map((i) => i.text)).toEqual(["更早的问题", "更早的回答"]);
		c.dispose();
	});
});

/* ------------------------------------------------------------------ 断流续传 */

describe("断流续传: half-answer restore", () => {
	it("backend still streaming → restores the mirrored half answer as the live row, frames overwrite it wholesale", async () => {
		composerState = { streaming: true };
		saveLiveMain(ID, { text: "恢复的半句", thinking: "恢复的思考", tools: [], at: Date.now() });
		const c = makeController();
		await settle();
		expect(c.state.live?.text).toBe("恢复的半句");
		expect(c.state.live?.thinking).toBe("恢复的思考");
		expect(c.state.working).toBe(true);
		// 恢复行不伪造元数据
		expect(c.state.live?.ts).toBeNull();
		expect(c.state.live?.model ?? null).toBeNull();
		expect(c.state.live?.usage ?? null).toBeNull();

		// 新帧是同一消息的全量快照：文本与思考都按帧整体覆盖，不拼接
		rpc(textFrame("恢复的半句，续"));
		await rafTick();
		expect(c.state.live?.text).toBe("恢复的半句，续");
		expect(c.state.live?.thinking).toBe("");
		c.dispose();
	});

	it("backend idle → restores a marked interrupted answer, deduped once the transcript carries it", async () => {
		saveLiveMain(ID, { text: "被打断的回答", thinking: "", tools: [], at: Date.now() });
		const c = makeController();
		await settle();
		expect(c.state.interrupted?.text).toBe("被打断的回答");
		expect(c.state.interrupted?.streaming).toBe(false);
		expect(c.state.live).toBeNull();
		expect(c.state.working).toBe(false);

		// 后续数据源出现同内容：自动去重，留存一并清理
		transcriptPages = [
			{
				items: [
					{ id: "u1", kind: "user", text: "你好" },
					{ id: "a1", kind: "assistant", text: "被打断的回答" },
				],
				nextOffset: 2,
			},
		];
		events.emit("touch", { sessionId: ID } as never);
		await settle();
		expect(c.state.interrupted).toBeNull();
		expect(loadLiveEntry(ID)?.stale).toBeUndefined();
		c.dispose();
	});

	it("dismiss removes the interrupted answer and its local mirror", async () => {
		saveLiveMain(ID, { text: "被打断的回答", thinking: "", tools: [], at: Date.now() });
		const c = makeController();
		await settle();
		expect(c.state.interrupted?.text).toBe("被打断的回答");

		c.dismissInterrupted();
		expect(c.state.interrupted).toBeNull();
		expect(loadLiveEntry(ID)?.stale).toBeUndefined();
		c.dispose();
	});

	it("content that already persisted is not restored at all", async () => {
		composerState = { streaming: true };
		transcriptPages = [
			{
				items: [{ id: "a1", kind: "assistant", text: "已经落盘的回答" }],
				nextOffset: 1,
			},
		];
		saveLiveMain(ID, { text: "已经落盘的回答", thinking: "", tools: [], at: Date.now() });
		const c = makeController();
		await settle();
		expect(c.state.live).toBeNull();
		expect(c.state.interrupted).toBeNull();
		expect(loadLiveEntry(ID)).toBeNull();
		c.dispose();
	});

	it("storage failures never break streaming, and a corrupted mirror is treated as absent", async () => {
		const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("quota exceeded");
		});
		const c = makeController();
		await rafTick();
		rpc({ type: "agent_start" });
		rpc(textFrame("正常流式不受存储异常影响"));
		await rafTick();
		expect(c.state.live?.text).toBe("正常流式不受存储异常影响");
		expect(c.state.working).toBe(true);
		c.dispose();
		setItem.mockRestore();

		localStorage.setItem(LIVE_SNAPSHOT_KEY, "{broken json");
		const c2 = makeController();
		await settle();
		expect(c2.state.live).toBeNull();
		expect(c2.state.interrupted).toBeNull();
		c2.dispose();
	});
});

describe("stream lifecycle ordering", () => {
	it("renders the finalized assistant snapshot instead of its previous partial update", async () => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("partial"));
		rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "finalized answer" }] } });
		await rafTick();
		expect(c.state.segments.map((s) => [s.text, s.streaming])).toEqual([["finalized answer", false]]);
		expect(c.state.live).toBeNull();
		c.dispose();
	});

	it("renders a final assistant even when no streaming update was delivered", async () => {
		const c = makeController();
		await rafTick();
		rpc({ type: "agent_start" });
		rpc({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "complete answer" }] } });
		rpc({ type: "agent_end", isTerminal: true });
		await rafTick();
		expect(c.state.segments.map((s) => s.text)).toEqual(["complete answer"]);
		expect(c.state.working).toBe(false);
		c.dispose();
	});

	it.each(["user", "toolResult"])("does not close an assistant segment for a %s message_end", async (role) => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("still streaming"));
		rpc({ type: "message_end", message: { role, content: [{ type: "text", text: "not an assistant" }] } });
		await rafTick();
		expect(c.state.live?.text).toBe("still streaming");
		expect(c.state.segments).toEqual([]);
		c.dispose();
	});

	it("does not resurrect working from a composer-state read started before the terminal frame", async () => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("answer"));
		const { promise, resolve: finish } = deferred<unknown>();
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/composer-state")
			? promise : routeApi(method, path));
		const pending = c.loadState();
		rpc({ type: "agent_end", isTerminal: true });
		finish({ streaming: true, model: "old" });
		await pending;
		await rafTick();
		expect(c.state.working).toBe(false);
		expect(c.state.cstate?.model).not.toBe("old");
		c.dispose();
	});

	it("keeps the latest composer-state response when requests finish out of order", async () => {
		const c = makeController();
		await rafTick();
		const reads = [deferred<unknown>(), deferred<unknown>()];
		let readIndex = 0;
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/composer-state")
			? reads[readIndex++].promise : routeApi(method, path));
		const older = c.loadState();
		const newer = c.loadState();
		reads[1].resolve({ streaming: false, model: "new" });
		await newer;
		reads[0].resolve({ streaming: true, model: "old" });
		await older;
		expect(c.state.cstate?.model).toBe("new");
		expect(c.state.working).toBe(false);
		c.dispose();
	});

	it("does not overwrite an acknowledged composer mutation with a previously started read", async () => {
		const c = makeController();
		await rafTick();
		const { promise, resolve: finish } = deferred<unknown>();
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/composer-state")
			? promise : routeApi(method, path));
		const pending = c.loadState();
		c.patchState({ planMode: true });
		finish({ planMode: false });
		await pending;
		expect(c.state.cstate?.planMode).toBe(true);
		c.dispose();
	});

	it("saves the latest half answer when detached before its animation frame flush", async () => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("the latest half answer"));
		c.dispose();
		expect(loadLiveEntry(ID)?.main?.text).toBe("the latest half answer");
		composerState = { streaming: false };
		const reopened = makeController();
		await rafTick();
		expect(reopened.state.interrupted?.text).toBe("the latest half answer");
		expect(reopened.state.interrupted?.streaming).toBe(false);
		reopened.dispose();
	});

	it("mirrors same-length text corrections rather than treating lengths as content identity", async () => {
		const c = makeController();
		await rafTick();
		let now = Date.now();
		vi.spyOn(Date, "now").mockImplementation(() => now);
		rpc(textFrame("first"));
		await rafTick();
		expect(loadLiveEntry(ID)?.main?.text).toBe("first");
		now += 650;
		rpc(textFrame("later"));
		await rafTick();
		expect(loadLiveEntry(ID)?.main?.text).toBe("later");
		c.dispose();
	});

	it("a late failed prompt response cannot roll back a stream that already started", async () => {
		const c = makeController();
		await rafTick();
		const { promise, reject: fail } = deferred<unknown>();
		promptExImpl = () => promise;
		const sending = c.send("question", "followUp");
		rpc({ type: "agent_start" });
		rpc(textFrame("accepted answer"));
		fail(new Error("connection lost after delivery"));
		await sending;
		await rafTick();
		expect(c.state.working).toBe(true);
		expect(c.state.live?.text).toBe("accepted answer");
		expect(c.state.delivery?.phase).toBe("unknown");
		c.dispose();
	});

	it("a late failed queued-send response cannot resurrect a terminated stream", async () => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("answer"));
		await rafTick();
		const { promise, reject: fail } = deferred<unknown>();
		promptExImpl = () => promise;
		const sending = c.send("follow-up", "followUp");
		rpc({ type: "agent_end", isTerminal: true });
		fail(new Error("connection lost"));
		await sending;
		await rafTick();
		expect(c.state.working).toBe(false);
		expect(c.state.delivery?.phase).toBe("unknown");
		c.dispose();
	});

	it("removes only withdrawn queued optimistic messages when stop restores them to the draft", async () => {
		const c = makeController();
		await rafTick();
		await c.send("active request", "followUp");
		await c.send("queued follow-up", "followUp");
		let draft = "existing draft";
		c.composer = { get: () => draft, set: (text) => { draft = text; } };
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/abort")
			? { aborted: true, restoredTexts: ["queued follow-up"] } : routeApi(method, path));
		await c.stop();
		expect(c.state.optimistic.map((o) => o.text)).toEqual(["active request"]);
		expect(draft).toBe("existing draft\n\nqueued follow-up");
		c.dispose();
	});
});

describe("refresh and detached response ownership", () => {
	it("ignores an incremental response superseded by a full refresh and replaces same-id rows", async () => {
		transcriptPages = [{ items: [{ id: "a", kind: "assistant", text: "before" }], nextOffset: 100, tailId: "a" }];
		const c = makeController();
		await rafTick();
		const oldRead = deferred<TranscriptPage>();
		let defer = true;
		apiMock.mockImplementation((method: string, path: string) => {
			if (path.includes("/transcript?") && defer) { defer = false; return oldRead.promise; }
			return routeApi(method, path);
		});
		const incremental = c.fetchTranscript();
		transcriptPages = [{ items: [{ id: "a", kind: "assistant", text: "after" }], nextOffset: 200, tailId: "a", reset: false }];
		await c.refresh();
		oldRead.resolve({ items: [{ id: "stale", kind: "assistant", text: "obsolete" }], nextOffset: 150, tailId: "stale" });
		await incremental;
		await settle();
		expect(c.state.transcript.items.map((i) => i.text)).toEqual(["after"]);
		const calls = apiMock.mock.calls.filter(([, path]) => String(path).includes("/transcript?"));
		expect(calls[calls.length - 1]?.[1]).toContain("from=0");
		c.dispose();
	});

	it("keeps the newer leaf when tree requests complete out of order", async () => {
		const c = makeController();
		await rafTick();
		const trees = [deferred<unknown>(), deferred<unknown>()];
		let treeIndex = 0;
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/tree")
			? trees[treeIndex++].promise : routeApi(method, path));
		await c.fetchTranscript();
		await c.fetchTranscript();
		trees[1].resolve({ leafId: "new-leaf" });
		await rafTick();
		trees[0].resolve({ leafId: "old-leaf" });
		await rafTick();
		expect(c.state.leafId).toBe("new-leaf");
		c.dispose();
	});

	it("uses an authoritative idle poll to retire a half answer after a missed terminal frame", async () => {
		const c = makeController();
		await rafTick();
		rpc(textFrame("retained answer"));
		await rafTick();
		composerState = { streaming: false };
		await c.loadState();
		await rafTick();
		expect(c.state.working).toBe(false);
		expect(c.state.live).toBeNull();
		expect(c.state.interrupted?.text).toBe("retained answer");
		c.dispose();
	});

	it("persists withdrawn queue text in its original session when stop finishes after detach", async () => {
		const c = makeController();
		await rafTick();
		const abort = deferred<unknown>();
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/abort") ? abort.promise : routeApi(method, path));
		const stopping = c.stop();
		c.dispose();
		saveUnsent(ID, "saved original draft");
		abort.resolve({ restoredTexts: ["withdrawn queue"] });
		await stopping;
		expect(loadUnsent(ID)).toBe("saved original draft\n\nwithdrawn queue");
		expect(new ChatController(ID).initialText).toBe("saved original draft\n\nwithdrawn queue");
	});

	it("does not navigate away from a different page when an old slash response creates a session", async () => {
		const c = makeController();
		await rafTick();
		const push = vi.spyOn(nav, "push").mockImplementation(() => {});
		const replace = vi.spyOn(nav, "replace").mockImplementation(() => {});
		const slash = deferred<unknown>();
		apiMock.mockImplementation((method: string, path: string) => path.endsWith("/slash") ? slash.promise : routeApi(method, path));
		const command = c.runCommand("new", "");
		c.dispose();
		slash.resolve({ sessionId: "new-session" });
		await command;
		expect(push).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	it("honors steer immediately after agent_start before the animation-frame render", async () => {
		const c = makeController();
		await rafTick();
		rpc({ type: "agent_start" });
		await c.send("interrupt", "steer");
		const request = apiMock.mock.calls.find(([, path]) => String(path).endsWith("/prompt-ex"));
		expect(request?.[2]).toMatchObject({ text: "interrupt", streamingBehavior: "steer" });
		c.dispose();
	});

	it("keeps an images-only optimistic preview valid until its persisted row arrives", async () => {
		const revoke = vi.fn();
		const original = URL.revokeObjectURL;
		URL.revokeObjectURL = revoke;
		const c = makeController();
		try {
			await rafTick();
			c.store.setState({ atts: [{ id: 1, name: "photo.png", isImage: true, status: "ok", path: "/tmp/photo.png", url: "blob:photo" }] });
			await c.send("", "followUp");
			expect(c.state.optimistic[0]?.imageUrls).toEqual(["blob:photo"]);
			expect(revoke).not.toHaveBeenCalledWith("blob:photo");
			transcriptPages = [{ items: [{ id: "image-user", kind: "user", text: "[Image #1: /tmp/photo.png]" }], nextOffset: 100 }];
			await c.fetchTranscript();
			expect(c.state.optimistic).toEqual([]);
			expect(revoke).toHaveBeenCalledWith("blob:photo");
		} finally {
			c.dispose();
			URL.revokeObjectURL = original;
		}
	});

	it("retains an interrupted suffix until a resumed live row actually carries all of it", async () => {
		saveLiveMain(ID, { text: "answer with its retained suffix", thinking: "", tools: [], at: Date.now() });
		composerState = { streaming: false };
		const c = makeController();
		await rafTick();
		rpc(textFrame("answer"));
		await rafTick();
		expect(c.state.interrupted?.text).toBe("answer with its retained suffix");
		rpc(textFrame("answer with its retained suffix and continuation"));
		await rafTick();
		expect(c.state.interrupted).toBeNull();
		c.dispose();
	});

	it("flushes the latest update immediately when a previously queued animation frame becomes hidden", async () => {
		const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
		let background = false;
		Object.defineProperty(document, "hidden", { configurable: true, get: () => background });
		const c = makeController();
		try {
			await rafTick();
			rpc(textFrame("before background"));
			background = true;
			rpc(textFrame("latest background update"));
			expect(c.state.live?.text).toBe("latest background update");
			expect(loadLiveEntry(ID)?.main?.text).toBe("latest background update");
		} finally {
			c.dispose();
			if (hidden) Object.defineProperty(document, "hidden", hidden);
			else Reflect.deleteProperty(document, "hidden");
		}
	});
});
