// 服务面板列表图的中文标签。
export const readerActions = ["ToggleAll", "ChangedEvent"];

export function state(v, facts) {
  const sw = v.all ? "开关选了全部端口" : "开关选了仅开发服务";
  const shown = { none: "还没有列表", dev: "显示的是开发服务列表", all: "显示的是全部端口列表" }[v.rows];
  const parts = [sw, shown];
  if (v.pending.length > 0) parts.push(`还有${v.pending.length}个请求未返回`);
  return parts.join("，");
}

export function group(v) {
  if (v.pending.length === 0 && v.rows !== "none" && (v.rows === "all") !== v.all) return "列表与开关不一致";
  if (v.pending.length > 0) return "请求进行中";
  return "列表一致";
}
export const groupColors = { "列表一致": "#d1f2eb", "请求进行中": "#e8f0fe" };

const STEPS = {
  ToggleAll: "点击全部端口开关",
  ChangedEvent: "收到服务变化通知",
  Respond: "一个列表请求返回",
};
export function step(action) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  return "开关连续切换后，先发出的请求后返回，把过期的列表覆盖到界面上，且没有任何请求序号或开关校验";
}
export const legend = { works: "与规则一致", wrong: "违反规则" };
