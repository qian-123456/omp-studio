// @vitest-environment jsdom
// 回放 MobilePrompt 与 MobilePending 模型：真实的 ChatController / api / useSessions，只替换 fetch。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const confirm = (id: string) => ({ request: { id, method: "confirm", title: `允许工具 ${id}？` } });
const session = {
	id: "s1", label: "测试", title: "测试", status: "awaiting_approval", pending: "approval",
	updatedAt: "2026-10-28T00:00:00Z", cwd: "/project", live: true,
};

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("MobilePrompt 回放", () => {
	it("故事 RestoredMeansNotSent / NoDuplicatePrompt：服务器已处理但响应超时，手机把原文放回输入框，再点发送服务器收到两条", async () => {
		const received: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, init: RequestInit) => {
				if (String(url).endsWith("/prompt-ex")) {
					received.push(JSON.parse(String(init.body)).text); // 服务器收到并处理
					return new Promise((_, reject) =>
						init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
					); // 响应永远没有送达
				}
				return Promise.resolve(json([]));
			}),
		);
		const { ChatController } = await import("/src-mobile/features/chat/chatStore.ts");
		const { useSessions } = await import("/src-mobile/core/stores/sessions.ts");
		useSessions.setState({ list: [{ ...session, status: "idle", pending: null }], byId: { s1: { ...session, status: "idle", pending: null } }, loaded: true, loading: false } as never);
		const c = new ChatController("s1");
		let box = "";
		c.composer = { get: () => box, set: (t: string) => void (box = t) };
		const first = c.send("部署到生产", "steer"); // 步骤：点发送
		await vi.advanceTimersByTimeAsync(0);
		expect(c.state.optimistic).toHaveLength(1);
		expect(box).toBe("");
		expect(received).toEqual(["部署到生产"]); // 步骤：服务器收到并处理
		await vi.advanceTimersByTimeAsync(30_000); // 步骤：请求超时
		await first;
		expect(box).toBe("部署到生产"); // 缺陷：输入框恢复原文，仿佛没有发送
		expect(c.state.optimistic).toHaveLength(0);
		const second = c.send(box, "steer"); // 步骤：用户看到失败后再点发送
		await vi.advanceTimersByTimeAsync(0);
		expect(received).toEqual(["部署到生产", "部署到生产"]); // 缺陷：服务器收到两条
		await vi.advanceTimersByTimeAsync(30_000);
		await second;
	});
});

describe("MobilePending 回放", () => {
	it("故事 BatchOnlyAnswersSeen：全部允许只发送动作，不带屏幕上的请求编号", async () => {
		const bodies: unknown[] = [];
		const serverPending = [confirm("a1"), confirm("a2"), confirm("a3")]; // a3 在手机最后一次读取之后才出现
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				if (String(url).endsWith("/ui-respond-all")) {
					bodies.push(JSON.parse(String(init.body)));
					return json({ handled: serverPending.length, skipped: 0 });
				}
				if (String(url).endsWith("/sessions")) return json([{ ...session, pending: null }]);
				return json([]);
			}),
		);
		const { ChatController } = await import("/src-mobile/features/chat/chatStore.ts");
		const { useSessions } = await import("/src-mobile/core/stores/sessions.ts");
		useSessions.setState({ list: [session], byId: { s1: session }, loaded: true, loading: false } as never);
		const c = new ChatController("s1");
		c.store.setState({ pendings: [confirm("a1"), confirm("a2")] as never }); // 屏幕上只有两个
		await c.approveAll("approve");
		expect(bodies).toEqual([{ action: "approve" }]); // 客户端请求里没有任何请求编号，范围由服务器当前列表决定
		expect(c.state.pendings.map((p: { request: { id: string } }) => p.request.id)).toEqual([]);
	});

	it("故事 NoAnsweredCardShown：较早发出的列表响应晚到，已回答的卡片重新出现", async () => {
		let releaseStale!: (v: Response) => void;
		let getCalls = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, init: RequestInit) => {
				const u = String(url);
				if (u.endsWith("/pending-ui")) {
					getCalls++;
					return new Promise<Response>((resolve) => (releaseStale = resolve)); // 较早的读取响应很慢
				}
				if (u.endsWith("/ui-respond")) return Promise.resolve(json({ ok: true }));
				if (u.endsWith("/sessions")) return Promise.resolve(json([{ ...session, status: "working", pending: null }])); // 服务器此时已无待处理
				return Promise.resolve(json({}));
			}),
		);
		const { ChatController } = await import("/src-mobile/features/chat/chatStore.ts");
		const { useSessions } = await import("/src-mobile/core/stores/sessions.ts");
		useSessions.setState({ list: [session], byId: { s1: session }, loaded: true, loading: false } as never);
		const c = new ChatController("s1");
		const stale = c.loadPendings(); // 步骤：手机请求待处理列表（此刻服务器还有 a1）
		await vi.advanceTimersByTimeAsync(0);
		expect(getCalls).toBe(1);
		c.store.setState({ pendings: [confirm("a1")] as never });
		await c.respond(confirm("a1") as never, { confirmed: true }); // 步骤：用户回答 a1，之后读取会话状态发现已无待处理
		expect(c.state.pendings).toEqual([]);
		releaseStale(json([confirm("a1")])); // 步骤：较早的响应晚于回答到达
		await stale;
		expect(c.state.pendings.map((p: { request: { id: string } }) => p.request.id)).toEqual(["a1"]); // 缺陷：已回答的卡片重新出现
	});
});
