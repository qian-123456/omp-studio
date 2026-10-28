// 存储页批量清理图例（简体中文，读者视角）。
export const readerActions = ["StartLive", "BeginTurn", "EndTurn", "StopLive", "TerminalAttach", "TerminalRelease", "TogglePin", "TrashCheck"];

export function state(v, facts) {
  const base = { idle: "会话空闲", liveIdle: "会话已在应用里启动，当前空闲", working: "会话正在回合中", terminalHeld: "会话被终端里的 omp 占用", trashed: "会话已移入废纸篓" }[v.sess];
  const pin = v.pinned ? "，已置顶" : "";
  const chk = v.checked ? "，清理检查已通过" : "";
  const bad = [];
  if (v.trashedWorking) bad.push("回合中的会话被删");
  if (v.stoppedLive) bad.push("检查后才启动的会话被停掉并删除");
  if (v.trashedHeld) bad.push("终端占用的会话被删");
  if (v.trashedPinned) bad.push("检查后才置顶的会话被删");
  return base + pin + chk + (bad.length ? "，" + bad.join("、") : "");
}

const STEPS = {
  StartLive: "在应用里启动会话",
  BeginTurn: "开始一个回合",
  EndTurn: "回合结束",
  StopLive: "停止会话",
  TerminalAttach: "终端里的 omp 开始占用",
  TerminalRelease: "终端释放会话",
  TogglePin: "置顶或取消置顶",
  TrashCheck: "点清理，检查通过",
  TrashApply: "真正移入废纸篓",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}
export function cause(v, facts, invariant) {
  return ({ NoTrashPinned: "检查后置顶未再次核验", NoTrashStartedAfterCheck: "检查后启动未再次核验", NoTrashTerminalHeld: "终端占用未再次核验" })[invariant] ?? "清理前状态发生变化";
}
