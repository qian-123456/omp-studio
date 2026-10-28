// 定时任务图例：状态与步骤全部使用读者可见的中文说明。
export const readerActions = ["UserDisable", "UserEnable", "RescheduleOnce", "RaiseCap", "UserDelete", "ManualCheck"];

const capped = (v) => v.cap > 0 && v.runsDone >= v.cap;
const lifecycle = (v) => {
	const done = v.cadence === "once" ? v.hasRunRow || v.everRan : capped(v);
	return done ? "已完成" : v.enabled ? "运行中任务" : "已暂停";
};

export function state(v) {
	if (!v.exists) return v.startedAfterDelete ? "已删除，却仍启动了运行" : "已删除";
	const kind = v.cadence === "once" ? "一次性" : v.cap > 0 ? "重复(有次数上限)" : "重复";
	const next = v.due === "none" ? "无下次触发" : v.due === "due" ? "已到点待领取" : "等待下次触发";
	const run = v.runCount > 1 ? `同时有${v.runCount}个运行` : v.runCount === 1 ? "正在运行" : "没有运行";
	const over = v.cap > 0 && v.runsDone > v.cap ? "，次数超过上限" : "";
	return `${lifecycle(v)}·${kind}：${next}，${run}${over}`;
}

export const groupColors = { 正常: "#d1f2eb", 已完成: "#e8eaf6", 已暂停: "#fff3cd" };
export function group(v) {
	if (!v.exists) return "已删除";
	return lifecycle(v) === "已完成" ? "已完成" : lifecycle(v) === "已暂停" ? "已暂停" : "正常";
}

const STEPS = {
	AppRestart: "应用重启，收尾上次未完成的运行",
	ExecCheck: "调度器确认没有在运行的记录",
	ExecCreate: "调度器创建运行记录并开始运行",
	ExecSkip: "调度器发现上次仍在运行，跳过本次",
	FinishFail: "运行失败、超时或进程异常退出",
	FinishOk: "运行正常结束",
	ManualCheck: "点击立即运行，确认没有在运行的记录",
	ManualCreate: "立即运行创建运行记录并开始运行",
	RaiseCap: "编辑任务去掉次数上限",
	RescheduleOnce: "把已执行的一次性任务改到新的未来时间",
	SchedulerClaim: "调度器到点领取任务并推进下次时间",
	TimeArrives: "到达计划的触发时间",
	UserDelete: "删除任务",
	UserDisable: "点击暂停",
	UserEnable: "点击启用",
};
export function step(action) {
	return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
	if (invariant === "ActiveRunsAtMostOne") return "调度器与立即运行都先确认没有运行再各自创建记录，两次确认之间没有互斥，于是同时出现两个运行";
	if (invariant === "CompletedNeverScheduled") return "已执行的一次性任务被改到新的未来时间后重新启用，但界面状态仍按已有运行记录判为已完成";
	if (invariant === "RunsWithinCap") return "立即运行不检查次数上限，仍累加已运行次数";
	if (invariant === "NoRunAfterDelete") return "任务被领取后、创建运行记录前被删除，运行记录因外键失败被忽略，运行仍继续";
	return null;
}
