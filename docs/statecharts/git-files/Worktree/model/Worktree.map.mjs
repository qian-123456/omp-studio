// 工作树清理图例（简体中文，读者视角）。
export const readerActions = ["CreateWorktree", "EditWorktree", "CommitWorktree", "AttachSession", "DetachSession", "TmRun", "TmStopRemove", "ScanOrphans", "ReclaimSession", "ReclaimTm"];

export function state(v, facts) {
  const s = v.sWt === "absent" ? "会话目录不存在" :
    "会话目录" + (v.sSession ? "有会话" : "无会话") + (v.sDirty ? "有改动" : "干净") + (v.sBranch === "unmerged" ? "分支未合并" : "");
  const t = v.tWt === "absent" ? (v.tProc === "none" ? "" : "，旧提交目录已删") :
    v.tProc === "running" ? "，旧提交正在运行" : "，旧提交已停";
  const ui = (v.shownS || v.shownT) ? "，孤儿列表有项" : "";
  const bad = [];
  if (v.killedLive) bad.push("运行中的旧提交被删了目录");
  if (v.lostSession) bad.push("在用的工作树被删");
  if (v.lostDirty) bad.push("改动没强制就被删");
  if (v.staleList) bad.push("列表仍显示已删除的目录");
  return s + t + ui + (bad.length ? "，" + bad.join("、") : "");
}

const STEPS = {
  CreateWorktree: "新建工作树",
  EditWorktree: "在工作树里改文件",
  CommitWorktree: "在工作树里提交",
  AttachSession: "会话开始使用该目录",
  DetachSession: "会话不再使用该目录",
  TmRun: "运行旧提交",
  TmExit: "旧提交进程退出",
  TmStopRemove: "停止并移除旧提交",
  ScanOrphans: "扫描孤儿工作树",
  ReclaimSession: "点回收会话工作树",
  ReclaimTm: "点回收旧提交工作树",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  return ({"NoKillRunningRun": "孤儿列表没有旧提交运行的占用信息", "NoRemoveInUse": "扫描后会话占用发生变化", "NoStaleListing": "目录删除成功但分支删除报错"})[invariant] ?? "生命周期边界";
}
