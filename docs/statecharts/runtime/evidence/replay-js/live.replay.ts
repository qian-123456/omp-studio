// 重放: 真实 useLive 存储的公开入口 reduceFrame / reduceProcess (src/stores/live.ts)。
import { beforeEach, describe, expect, it } from "vitest";
import { useLive } from "<repo>/src/stores/live";

const SID = "s1";
const frame = (f: Record<string, unknown>) => useLive.getState().reduceFrame({ sessionId: SID, frame: f });
const proc = (running: boolean) => useLive.getState().reduceProcess({ sessionId: SID, running, exitCode: running ? null : 0 });
const live = () => useLive.getState().sessions[SID];
beforeEach(() => useLive.setState({ sessions: {} }));

describe("bug: 进程退出后迟到的开始帧", () => {
  it("退出事件之后再收到遗留的 agent_start，界面永远转圈", () => {
    proc(true);
    frame({ type: "agent_start" });
    proc(false); // rpc:process running=false
    expect(live().streaming).toBe(false);
    frame({ type: "agent_start" }); // 读取循环迟到的帧 (process.rs:942 在监视器之后才处理)
    expect(live().alive).toBe(false);
    expect(live().streaming).toBe(true); // 进程已死, 仍在转圈
  });
});

describe("bug: 回合结束后待答卡片保留", () => {
  it("终止 agent_end 之后 pendingUi 仍在", () => {
    proc(true);
    frame({ type: "agent_start" });
    frame({ type: "extension_ui_request", id: "r1", method: "confirm", title: "Allow tool bash?" });
    expect(live().pendingUi.length).toBe(1);
    frame({ type: "agent_end", isTerminal: true });
    expect(live().streaming).toBe(false);
    expect(live().pendingUi.length).toBe(1); // 卡片仍可回答
  });
});

describe("bug: 子代理终态被迟到的进度帧倒退", () => {
  it("completed 之后收到 status=running 的 subagent_progress 回到运行中", () => {
    frame({ type: "subagent_lifecycle", payload: { id: "a1", status: "started", index: 0 } });
    frame({ type: "subagent_lifecycle", payload: { id: "a1", status: "completed", index: 0 } });
    expect(live().subagents.a1.status).toBe("completed");
    frame({ type: "subagent_progress", payload: { index: 0, agent: "task", task: "t", progress: { id: "a1", status: "running", index: 0, agent: "task", task: "t", recentTools: [], recentOutput: [], toolCount: 0, requests: 0, tokens: 0, cost: 0, durationMs: 0 } } });
    expect(live().subagents.a1.status).toBe("running");
  });
});
