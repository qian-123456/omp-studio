// 抽屉终端生命周期图的中文标签。标签只写读者看得到的现象，不出现变量名或动作名。
export const readerActions = [
  "OpenPanel", "ClosePanel", "SwitchTab", "PtyExit", "CloseTab",
  "DetachTab", "ReattachTab", "Reconnect", "AppRestart",
];

const TAB = {
  none: "没有标签",
  opening: "标签显示连接中",
  ready: "标签显示运行中",
  exited: "标签显示已退出",
  error: "标签显示启动失败",
};
const PTY = { none: "没有终端进程", alive: "终端进程在运行", dead: "终端进程已结束" };

export function state(v, facts) {
  const parts = [TAB[v.tab], PTY[v.pty]];
  if (v.detached) parts.push("已折叠为后台服务");
  else if (v.tab !== "none") parts.push(v.panelMounted ? "面板已打开" : "面板未打开");
  if (v.spawn === "pending") parts.push("启动请求未返回");
  if (v.exitGen !== 0) parts.push("退出通知在路上");
  if (v.outputLost) parts.push("第一段输出已丢失");
  if (v.tab === "opening" && v.entry === "none" && v.spawn === "none" && !v.effectDue && v.panelMounted && !v.detached)
    parts.push("界面里没有终端");
  return parts.join("，");
}

export function group(v) {
  if (v.tab === "ready" && v.pty !== "alive") return "显示运行中但进程已不在";
  if (v.tab === "opening" && v.entry === "none" && v.panelMounted && !v.detached) return "连接中却没有终端";
  if (v.tab === "ready") return "终端运行中";
  if (v.tab === "exited" || v.tab === "error") return "已退出或失败";
  if (v.tab === "none") return "没有标签";
  return "连接中";
}
export const groupColors = {
  "终端运行中": "#d1f2eb",
  "连接中": "#e8f0fe",
  "已退出或失败": "#eeeeee",
  "没有标签": "#ffffff",
};

const STEPS = {
  OpenPanel: "打开终端面板",
  ClosePanel: "切走右侧面板",
  SwitchTab: "切换标签再切回",
  PtyExit: "shell 退出",
  CloseTab: "关闭标签",
  DetachTab: "折叠成后台服务",
  ReattachTab: "从服务面板接回终端",
  Reconnect: "点击重新连接",
  AppRestart: "重启应用",
  CreateTerminal: "界面创建终端并请求启动",
  ReattachTerminal: "面板重新挂载已有终端",
  BackendSpawnOk: "后端成功启动 shell",
  BackendSpawnFail: "后端启动失败",
  SpawnResolve: "启动请求返回",
  PtyOutput: "shell 打印第一段输出",
  DeliverExit: "界面收到退出通知",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  if (invariant === "ReadyMeansAlive")
    return "shell 在启动请求返回之前就退出了，退出通知因为界面还不认识该终端而被丢弃，标签随后被标成运行中";
  if (invariant === "OpeningMakesProgress")
    return "点击重新连接只销毁了旧终端并把标签改回连接中，而创建终端的流程只在标签切换或面板挂载时才会再次运行";
  if (invariant === "OutputNotLost")
    return "shell 的第一段输出在启动请求返回之前到达，而界面此时还不认识该终端，数据被直接丢弃";
  if (invariant === "NoLeakAfterClose") return "标签关闭时刚启动的终端进程没有被清理";
  return null;
}

export const legend = { works: "与规则一致", wrong: "违反规则" };
