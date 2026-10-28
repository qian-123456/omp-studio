// 重放: 真实状态扩展默认导出 (extension/omp-workspace-status.ts), 用伪造的宿主 pi 驱动事件。
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bug: 切换到没有文件的新会话时继承旧会话文件", () => {
  it("新会话状态文件写入了旧会话的 sessionFile", async () => {
    const home = mkdtempSync(join(tmpdir(), "ompws-ext-"));
    process.env.HOME = home;
    const mod = await import("<repo>/extension/omp-workspace-status");
    const handlers: Record<string, (e: unknown, ctx: unknown) => void> = {};
    mod.default({ on: (ev: string, h: (e: unknown, ctx: unknown) => void) => { handlers[ev] = h; } });
    const ctx = (id: string, file?: string) => ({ sessionManager: { getSessionId: () => id, getSessionFile: () => file } });
    handlers.session_start({}, ctx("old1", "/sessions/old1.jsonl"));
    handlers.session_switch({}, ctx("new2", undefined));
    const dir = join(home, ".omp-workspace", "status");
    const read = (id: string) => JSON.parse(readFileSync(join(dir, id + ".json"), "utf8"));
    expect(readdirSync(dir).sort()).toEqual(["new2.json", "old1.json"]);
    expect(read("old1").state).toBe("exited");
    expect(read("new2").sessionFile).toBe("/sessions/old1.jsonl"); // 新会话无文件却指向旧文件
  });
});
