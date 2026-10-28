// 定时运行结果在收件箱的呈现图例。
export const readerActions = ["UserViewsSession", "UserDoneTodo"];

const policyCN = { all: "每次都提醒", important: "仅重要时提醒", none: "不放入收件箱" };

export function state(v) {
	const rows = [];
	if (v.sessRow) rows.push("会话条目");
	if (v.todoRow === "open") rows.push("结果待办");
	return `${policyCN[v.policy]}；${rows.length ? rows.join("＋") : "没有条目"}`;
}

const STEPS = {
	RunOkWithSession: "运行在会话中顺利结束",
	RunFailWithSession: "运行在会话中失败或超时",
	RunFailBeforeSession: "运行在启动会话前就失败",
	UserViewsSession: "用户打开了这个会话",
	UserDoneTodo: "用户把结果待办标为完成",
};
export function step(action) {
	return STEPS[action] ?? action;
}
export function cause(v, facts, inv) {
	if (inv === "OneEntryPerRun") return "运行用的会话自己进入收件箱，同时通知策略又生成了一条结果待办";
	return "通知策略只控制结果待办，运行用的会话依旧凭自己的关注度进入收件箱";
}
