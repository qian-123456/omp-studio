// 会话终端登记表图的中文标签。
export const readerActions = ["OpenSessionTerm", "PtyExit", "CloseTerm", "DeleteSession"];

export function state(v, facts) {
  const p = { none: "没有终端进程", alive: "终端进程在运行", dead: "终端进程已结束" }[v.pty];
  const parts = [v.sessionExists ? "会话存在" : "会话已删除", p];
  if (v.opened) parts.push("终端刚启动，尚未登记");
  parts.push(v.rec ? "登记表认为终端打开" : "登记表为空");
  return parts.join("，");
}

export function group(v) {
  if (v.rec && v.pty !== "alive") return "终端已结束却仍被登记";
  if (!v.sessionExists && v.pty === "alive") return "会话已删除仍有终端";
  if (v.pty === "alive") return "终端运行中";
  return "无终端";
}
export const groupColors = { "终端运行中": "#d1f2eb", "无终端": "#ffffff" };

const STEPS = {
  OpenSessionTerm: "打开会话终端",
  PtyExit: "终端里的 omp 退出",
  CloseTerm: "关闭终端",
  DeleteSession: "删除会话",
  RecordSessionTerm: "后端把终端写入登记表",
};
export function step(action) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  if (invariant === "RecordMeansAlive")
    return "终端在被写入登记表之前就已经退出，退出时的清理发现登记表里没有它，随后登记表又写入了这个已死的终端，会话的结构化通道因此一直被挡住";
  if (invariant === "DeletedSessionHasNoTerminal")
    return "删除会话发生在终端刚启动、尚未登记的间隙，删除只清理登记表里已有的终端，随后新终端又被登记到已删除的会话上";
  return null;
}
export const legend = { works: "与规则一致", wrong: "违反规则" };
