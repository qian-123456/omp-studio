// 每轮对话存档与撤回的图例文字（简体中文，读者视角）。
export const readerActions = ["StartTurn", "UserEdit", "Undo", "SessionSwitchMidTurn"];

function turnText(v, t) {
  const p = v.phase[t];
  if (p === "idle") return null;
  if (p === "running") return `第${t}轮进行中`;
  if (p === "orphan") return `第${t}轮被中断` + (v.refs[t] === "before" ? "且留下残留快照" : "");
  if (p === "empty") return null;
  if (v.undoneRef[t]) return `第${t}轮已撤回`;
  if (v.everUndone[t]) return `第${t}轮撤回标记丢失`;
  if (v.refs[t] === "none") return `第${t}轮存档已清理`;
  return `第${t}轮可撤回`;
}

export function state(v, facts) {
  const turns = [1, 2, 3].map((t) => turnText(v, t)).filter(Boolean);
  const file = { base: "文件是初始内容", t1: "文件是第1轮写的", t2: "文件是第2轮写的", t3: "文件是第3轮写的", user: "文件被用户改过" }[v.fileV];
  return (turns.length ? turns.join("，") : "还没有记录") + "；" + file;
}

const STEPS = {
  AgentEdit: "代理写入文件",
  EndTurnEmpty: "一轮结束，没有改动",
  EndTurnRecorded: "一轮结束，记录存档",
  SessionSwitchMidTurn: "一轮进行中切换了会话",
  StartTurn: "代理开始新一轮",
  Undo: "点撤回",
  UserEdit: "用户自己改了文件",
};
export function step(action, before, after) {
  if (action === "Undo") {
    const ks = [1, 2, 3].filter((t) => after.undoneRef[t] && !before.undoneRef[t]);
    return `点撤回第${ks[0]}轮` + (ks.length > 1 ? "（连带更新的轮次）" : "");
  }
  if (action === "StartTurn") {
    const t = [1, 2, 3].find((i) => before.phase[i] === "idle" && after.phase[i] === "running");
    return `代理开始第${t}轮`;
  }
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  return ({ NoLeftoverSnapshots: "切换会话仅忘记当前轮次", NoSilentOverwrite: "轮内用户改动归入轮次快照", UndoneStaysUndone: "旧轮次清理一并删除撤回标记" })[invariant] ?? "存档边界";
}
