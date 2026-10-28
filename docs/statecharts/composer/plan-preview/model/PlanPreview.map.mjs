// Chart labels for the composer plan-preview model (Chinese reader words).
const M = { O: "普通模型", X: "另选普通模型", A: "计划模型甲", B: "计划模型乙", none: "无" };
const shown = (v) => {
	const pv = v.planMode || v.chip === "plan";
	if (!pv) return v.draftModel;
	if (v.planEditState !== "none") return v.planEditState;
	if (v.planMode && v.statusPlanModel !== "none") return v.statusPlanModel;
	if (v.planRolesState !== "none") return v.planRolesState;
	return v.draftModel;
};
export const readerActions = ["SelectPlanChip", "RemovePlanChip", "OrdinaryPick", "PickPlanModel", "SendPlanChip", "StatusRepublished", "DisablePlan"];
export function state(v) {
	const mode = v.planMode ? "计划模式已开启" : v.chip === "plan" ? "待发送的计划标签" : v.planSend === "sending" ? "计划命令发送中" : "普通输入";
	const wait = [v.saveFlight.st !== "idle" ? "保存角色中" : "", v.readFlight.st !== "idle" ? "读取角色中" : ""].filter(Boolean).join("、");
	return `${mode}：芯片显示${M[shown(v)]}，进程运行${M[v.ompProcessModel]}，已存角色${M[v.modelRoleFile]}${wait ? "（" + wait + "）" : ""}`;
}
const STEPS = {
	AutoApplyPlanModel: "界面把显示的计划模型应用到进程",
	DisablePlan: "退出计划模式",
	OrdinaryPick: "选择另一个普通模型",
	PickPlanModel: "在选择器里为计划挑模型",
	PlanCommandAccepted: "扩展确认进入计划模式",
	PlanCommandFails: "计划命令失败，标签回来",
	ReadArrives: "角色读取结果到达",
	ReadExecutes: "后台读出计划角色",
	ReadFails: "角色读取静默失败",
	RemovePlanChip: "删除计划标签",
	SelectPlanChip: "选中计划标签",
	SendPlanChip: "发送计划标签",
	StatusRepublished: "新一轮结束后状态重新发布",
	WriteFails: "保存角色失败",
	WriteReplyArrives: "保存结果回到界面",
	WriteRoleFile: "后台写入计划角色",
};
export function step(action) {
	return STEPS[action] ?? action;
}
