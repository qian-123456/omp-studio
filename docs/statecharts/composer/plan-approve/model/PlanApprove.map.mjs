// Chart labels for the plan approval model (Chinese reader words).
export const readerActions = ["ClickApprove", "ReEnablePlan", "PlanRepublished"];
export function state(v) {
	const mode = v.s_enabled ? (v.planFile === "written" ? "计划审阅面板可批准" : "计划模式开启，等待计划") : "计划模式已退出，面板无批准按钮";
	const run = v.approveBusy === "idle" ? "" : "，批准处理中";
	const exec = v.execSession === "started" ? "，执行会话已开始" : v.approveFailed ? "，提示批准失败" : "";
	return `${mode}${run}${exec}`;
}
const STEPS = {
	ClickApprove: "点击批准（新上下文执行）",
	ExtensionExits: "扩展退出计划模式",
	CreateSessionOk: "新会话创建并开始执行",
	CreateSessionFails: "新会话创建失败",
	ReEnablePlan: "重新开启计划模式",
	PlanRepublished: "一轮结束，计划重新出现",
};
export function step(action) {
	return STEPS[action] ?? action;
}
