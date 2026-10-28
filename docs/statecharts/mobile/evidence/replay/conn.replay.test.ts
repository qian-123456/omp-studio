// @vitest-environment jsdom
// 回放 MobileConn 模型的两条故事：真实的 startEvents / SseClient / useConnection / api，只替换 EventSource 与 fetch 这两个外部 I/O。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeES {
	static all: FakeES[] = [];
	readyState = 1;
	onerror: ((e: unknown) => void) | null = null;
	private l: Record<string, Array<(e: { data: string }) => void>> = {};
	constructor(public url: string) {
		FakeES.all.push(this);
	}
	addEventListener(t: string, fn: (e: { data: string }) => void) {
		(this.l[t] ??= []).push(fn);
	}
	emit(t: string, data: unknown = {}) {
		for (const fn of this.l[t] ?? []) fn({ data: JSON.stringify(data) });
	}
	close() {
		this.readyState = 2;
	}
}
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
let status = 200;
beforeEach(() => {
	vi.resetModules();
	FakeES.all = [];
	status = 200;
	vi.stubGlobal("EventSource", FakeES);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(status === 200 ? "[]" : "{}", { status, headers: { "content-type": "application/json" } })),
	);
});
afterEach(() => vi.unstubAllGlobals());

async function boot() {
	const sse = await import("/src-mobile/core/sse.ts");
	const conn = await import("/src-mobile/core/stores/connection.ts");
	sse.startEvents();
	await flush();
	return { conn, sse };
}

describe("MobileConn 回放", () => {
	it("故事 BannerMatchesStream：断网提示后恢复网络，事件流没断但横幅仍是已断开", async () => {
		const { conn } = await boot();
		FakeES.all[0].emit("hello");
		expect(conn.useConnection.getState().phase).toBe("open"); // 步骤：探测成功、收到问候
		window.dispatchEvent(new Event("offline")); // 步骤：手机提示网络断开
		expect(conn.useConnection.getState().phase).toBe("closed");
		window.dispatchEvent(new Event("online")); // 步骤：手机提示网络恢复
		await flush();
		expect(FakeES.all).toHaveLength(1); // 事件流没有重建
		expect(FakeES.all[0].readyState).toBe(1); // 事件流仍然存活
		expect(conn.useConnection.getState().phase).toBe("closed"); // 缺陷：横幅仍显示已断开
		expect(conn.useConnection.getState().error).toBe("网络已断开");
	});

	it("故事 UnauthorizedSticky：配对失效后手机提示断网，覆盖了配对失效提示", async () => {
		status = 401;
		const { conn } = await boot();
		expect(conn.useConnection.getState().phase).toBe("unauthorized");
		window.dispatchEvent(new Event("offline"));
		expect(conn.useConnection.getState().phase).toBe("closed"); // 缺陷
		expect(conn.useConnection.getState().error).toBe("网络已断开");
		// 恢复网络时 resume 会重新探测并再次得到 401，横幅才回到配对失效
		window.dispatchEvent(new Event("online"));
		await flush();
		expect(conn.useConnection.getState().phase).toBe("unauthorized");
	});
});
