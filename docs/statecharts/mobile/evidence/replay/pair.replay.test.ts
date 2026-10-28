// @vitest-environment jsdom
// 回放配对客户端：真实的 pairWithCode；jsdom 不加载 iframe，所以由测试触发 load 事件，fetch 为外部 I/O。
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("配对客户端回放", () => {
	it("无效配对码也被报告为配对成功：成功只取决于之后的 GET /sessions 是否 2xx", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }))); // 手机已有旧的有效 cookie
		vi.stubGlobal("EventSource", class { readyState = 1; onerror = null; addEventListener() {} close() {} });
		const { pairWithCode } = await import("/src-mobile/core/pair.ts");
		const p = pairWithCode("already-used-code");
		const frame = document.querySelector("iframe")!;
		expect(frame.getAttribute("src")).toBe("/pair?code=already-used-code");
		frame.dispatchEvent(new Event("load")); // 无论 /pair 返回 303 还是 403 页面，iframe 都会触发 load
		expect(await p).toBe(true); // 缺陷：没有检查配对页面的结果
	});
});
