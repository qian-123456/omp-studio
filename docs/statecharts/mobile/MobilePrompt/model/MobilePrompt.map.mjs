export const readerActions = ["Type", "TapSend", "ClientFailure"];
const C = { draft: "输入框有文字", empty: "输入框为空", restored: "输入框已恢复原文" };
const R = { none: "未发送", inflight: "发送中", failed: "显示发送失败", done: "显示已发送" };
export function state(v) {
	return `${R[v.req]}: ${C[v.composer]}，${v.optimistic ? "有临时气泡" : "无临时气泡"}，服务器已收到${v.serverPrompts}条${v.serverSeen && v.req === "inflight" ? "（本次已到达）" : ""}`;
}
const S = {
	Type: "用户输入文字", TapSend: "点发送", ServerReceives: "服务器收到并处理这条消息",
	ResponseOk: "成功响应送达手机", ClientFailure: "请求超时或网络中断",
};
export function step(a) { return S[a] ?? a; }
export function cause(v, f, inv) {
	if (inv === "RestoredMeansNotSent") return "手机超时后无法得知服务器已处理，仍把原文放回输入框";
	return "超时恢复的原文被再次发送，服务器没有去重";
}
