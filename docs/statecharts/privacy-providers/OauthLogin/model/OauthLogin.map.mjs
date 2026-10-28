// 授权登录对话框: 标签为简体中文，面向产品评审者。
export const readerActions = ["StartFlow", "BackUnlisten", "DismissAsk", "DismissKeep", "DismissConfirmed", "CloseFinished", "ParentUnmount"];

export function state(v) {
  const ui = { list: "对话框在供应商列表", flow: "对话框在登录步骤", closed: "对话框已关闭" }[v.phase];
  const flow = v.phase === "flow" ? { running: "，登录进行中", ok: "，界面显示登录成功", failed: "，界面显示登录失败" }[v.uiDone] + (v.confirmOpen ? "，正在询问是否取消" : "") : "";
  const start = v.startState === "inFlight" ? "，启动请求还在途中" : "";
  const back = !v.active ? "后台没有登录进程" : v.result === "pending" ? "后台登录进程在等待授权" : "后台登录进程已结束待清理";
  const cancel = v.pendingCancel ? "，取消请求在途中" : "";
  const cred = v.credSaved ? (v.panelStale ? "，授权已保存但列表没刷新" : "，授权已保存") : "";
  return `${ui}${flow}${start}；${back}${cancel}${cred}`;
}
const STEPS = {
  StartFlow: "选择供应商开始登录",
  BackendStart: "后台开始登录进程",
  LoginSucceeds: "浏览器授权成功",
  LoginFails: "浏览器授权失败",
  BackendCleanup: "后台清理登录进程",
  BackUnlisten: "点上一步",
  CancelCall: "后台处理取消请求",
  DismissAsk: "点关闭，弹出取消确认",
  DismissKeep: "选择继续登录",
  DismissConfirmed: "确认取消登录并关闭",
  CloseFinished: "登录结束后关闭",
  ParentUnmount: "外层页面把对话框拿掉",
};
export function step(action) { return STEPS[action] ?? action; }
export function cause(v, facts, invariant) {
  if (invariant === "PanelShowsSavedLogin") return "授权成功的通知到达前，对话框已经停止监听，成功通知被丢弃，没有刷新供应商列表";
  return "取消请求先于启动请求被后台处理，之后启动请求才生效，登录进程在没有界面的情况下继续等待授权";
}
export function group(v) {
  if (v.credSaved && v.panelStale) return "授权已保存但列表过期";
  if (v.phase !== "flow" && v.active && v.result === "pending" && !v.pendingCancel && v.startState !== "inFlight" && !(v.uiFlowActive)) return "遗留无人管理的登录进程";
  return "正常";
}
export const groupColors = { "授权已保存但列表过期": "#ffe9c7", "遗留无人管理的登录进程": "#fde2e2", "正常": "#e2f5e9" };
