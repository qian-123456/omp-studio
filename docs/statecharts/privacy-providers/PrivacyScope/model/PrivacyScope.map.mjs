// 隐私标记范围: 读者是产品评审者。标签全部使用简体中文。
export const readerActions = ["OpenPopover", "ClosePopover", "ConfirmFuture", "ConfirmAll", "Untrack", "DeleteEntry"];

export function state(v, facts) {
  const hist = v.history === "realSent" ? "会话里已有明文密钥" : "会话里没有明文密钥";
  const link = { none: "未绑定本会话", all: "已绑定并保护全部历史", future: "已绑定但只保护之后的内容" }[v.link];
  const entry = v.entry ? (v.tracked ? "条目启用" : "条目已停用") : "尚无条目";
  const pop = v.popover === "open" ? (v.shownSent ? "弹窗打开并提示已发送过" : "弹窗打开") + (v.popTrack ? "" : "，勾选了不跟踪") : "弹窗关闭";
  const ask = { none: "", futureOnly: "，用户要求只保护之后", all: "，用户要求连旧历史一起替换" }[v.wanted];
  const leak = v.history === "realSent" && !(v.entry && v.tracked && v.link !== "future") ? "，旧消息仍含明文" : "";
  return `${hist}，${entry}，${link}，${pop}${ask}${leak}`;
}

const STEPS = {
  OpenPopover: "选中文字并点标记为隐私",
  ClosePopover: "关闭标记弹窗",
  ConfirmFuture: "点仅保护后续内容或标记",
  ConfirmAll: "点同时替换旧历史",
  Untrack: "在设置里停用这个条目",
  DeleteEntry: "在设置里删除这个条目",
};
export function step(action, before, after) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  return v.tracked
    ? "此前选过只保护之后的内容，现在再点替换旧历史，系统保留了原来的截止点，旧消息仍发给上游"
    : "这个条目此前被停用，再次标记时系统没有重新启用，旧消息和新消息都不会被替换";
}

export function group(v) {
  return v.history === "realSent" && !(v.entry && v.tracked && v.link !== "future") ? "旧消息仍可见明文" : "旧消息已受保护或无明文";
}
export const groupColors = { "旧消息仍可见明文": "#fde2e2", "旧消息已受保护或无明文": "#e2f5e9" };
