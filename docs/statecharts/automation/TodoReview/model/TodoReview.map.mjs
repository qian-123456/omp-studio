// 验收待办图例。
export const readerActions = ["UserAcceptReview", "UserIgnoreReview", "UserReopenReview", "ToggleDetection"];

const todoCN = (t) => ({ none: "没有待办", open: "待办待处理", done: "待办已完成", ignored: "待办已忽略" })[t];

export function state(v) {
	const s = v.sess === "review" ? "会话待验收" : v.sess === "working" ? "会话工作中" : "会话空闲";
	return `${s}，${todoCN(v.reviewTodo)}`;
}

const STEPS = {
	TurnEndsReview: "回合结束，会话进入待验收",
	NewTurn: "用户再发一条提示，开始新回合",
	UserAcceptReview: "在待办里点完成验收",
	UserIgnoreReview: "忽略这条待办",
	UserReopenReview: "重新打开这条待办",
	ToggleDetection: "切换系统检测开关",
	Reconcile: "后台每分钟对账一次",
};
export function step(action) {
	return STEPS[action] ?? action;
}
