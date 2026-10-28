// 请求待办图例。
export const readerActions = ["UserIgnoreUi", "UserDoneUi", "UserReopenUi", "ToggleDetection"];

const todoCN = (t) => ({ none: "没有待办", open: "待办待处理", done: "待办已完成", ignored: "待办已忽略" })[t];

export function state(v) {
	const proc = v.live ? (v.uiPending ? "有待回答的请求" : "没有待回答的请求") : "会话进程已退出";
	return `${proc}，${todoCN(v.uiTodo)}`;
}

const STEPS = {
	DialogRequest: "会话弹出需要回答的请求",
	UiAnswered: "用户回答了请求",
	ProcessExit: "会话进程退出",
	ProcessStart: "会话被恢复，进程重新启动",
	UserIgnoreUi: "忽略这条待办",
	UserDoneUi: "把这条待办标为完成",
	UserReopenUi: "重新打开这条待办",
	ToggleDetection: "切换系统检测开关",
	Reconcile: "后台每分钟对账一次",
};
export function step(action) {
	return STEPS[action] ?? action;
}
