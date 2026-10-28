export const readerActions = ["RespondOne", "ApproveAll"];
const L = (a) => (a.length ? a.map((x) => `请求${x}`).join("、") : "无");
export function state(v) {
	return `屏幕显示：${L(v.shown)}; 服务器待处理：${L(v.serverPending)}，已回答：${L(v.answered)}${v.snaps.length ? `，在途快照${v.snaps.length}个` : ""}`;
}
const S = {
	ServerAsks: "运行端发出新的审批请求", StartLoad: "手机请求待处理列表",
	DeliverLoad: "待处理列表响应送达并替换屏幕", RespondOne: "用户单独回答一张卡片", ApproveAll: "用户点全部允许",
};
export function step(a, b, c) {
	if (a === "RespondOne") return `用户单独回答请求${b.serverPending.find((x) => !c.serverPending.includes(x))}`;
	return S[a] ?? a;
}
export function cause(v, f, inv) {
	if (inv === "BatchOnlyAnswersSeen") return "批量允许按服务器当前的全部请求执行，包含用户还没看到的新请求";
	return "较早发出的列表响应晚于回答到达，把已回答的请求重新显示出来";
}
