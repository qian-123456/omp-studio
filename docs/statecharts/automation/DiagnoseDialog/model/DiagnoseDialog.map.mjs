// 诊断对话框图例。
export const readerActions = ["UserEditsPrompt", "UserChoosesSession", "UserExecute"];

export function state(v) {
	if (!v.open) return v.sent > 1 ? "对话框已关闭，诊断发了多次" : "对话框已关闭";
	const parts = [v.loading ? "正在生成提示词" : "提示词已就绪"];
	if (v.edited) parts.push("用户改过提示词");
	if (v.chosen) parts.push("用户选了诊断会话");
	if (v.btnBusy) parts.push("按钮显示发送中");
	if (v.inFlight && !v.btnBusy) parts.push("请求仍在发送但按钮已恢复可点");
	if (v.erased) parts.push("用户的修改已被覆盖");
	if (v.sent > 1) parts.push("已发多次");
	return parts.join("，");
}

const STEPS = {
	PromptLoaded: "提示词生成完毕",
	UserEditsPrompt: "用户修改提示词",
	UserChoosesSession: "用户选择诊断会话",
	UserExecute: "点击开始诊断",
	DispatchDone: "诊断发送完成，对话框关闭",
	SessionsUpdated: "后台会话列表刷新了一次",
};
export function step(action) {
	return STEPS[action] ?? action;
}
export function cause(v, facts, inv) {
	return inv === "UserWorkPreserved"
		? "打开对话框时的初始化动作依赖会话列表，列表每次刷新都会重新生成提示词并重置选择"
		: "列表刷新把发送中状态清零，按钮重新可点，而上一次请求仍在进行";
}
