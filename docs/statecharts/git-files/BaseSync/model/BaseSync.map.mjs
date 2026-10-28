// 基础分支同步图例（简体中文，读者视角）。
export const readerActions = ["SyncMerge", "SyncConflict", "SyncSkipMerge", "SyncFastForward", "RebaseOk", "RebaseConflict"];

export function state(v, facts) {
  const rel = (v.behind ? "基础分支有新提交" : "基础分支没有新提交") + (v.ahead ? "，分支有独有提交" : "，分支无独有提交");
  const env = (v.dirty ? "，工作区有改动" : "，工作区干净") + (v.conflictBase ? "，会与基础分支冲突" : "") + (v.mainBlocks ? "，主工作区会挡住快进" : "");
  const run = v.step === "merged" ? "；已并入基础分支，等待快进" : "";
  const res = v.result === "ok" ? "；界面显示成功" : v.result === "error" ? "；界面显示失败" : "";
  const bad = v.halfDone ? "；报错了但分支已多出合并提交" : "";
  return rel + env + run + res + bad;
}

const STEPS = {
  SyncMerge: "点同步，并入基础分支",
  SyncConflict: "点同步，并入时冲突",
  SyncSkipMerge: "点同步，无需并入",
  SyncFastForward: "快进基础分支",
  RebaseOk: "点变基，成功",
  RebaseConflict: "点变基，冲突后中止",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}
export function cause(v, facts, invariant) {
  return ({"ErrorLeavesBranchUntouched": "并入已成功而快进失败"})[invariant] ?? "生命周期边界";
}
