// Chart labels for the fork plan-state model (Chinese reader words).
const W = { answer: "回答", planOn: "开启计划", planOff: "关闭计划" };
export const readerActions = ["AppendPlanOn", "AppendPlanOff", "AppendAnswer", "ForkSession"];
export function state(v) {
	const log = v.transcript.length ? v.transcript.map((x) => W[x]).join("→") : "空记录";
	let on = false;
	for (const x of v.transcript) if (x === "planOn") on = true; else if (x === "planOff") on = false;
	const fork = v.forkMode === "none" ? "尚未分支" : `已分支，副本${v.forkPlanOn === "on" ? "处于计划模式" : "不在计划模式"}`;
	return `父会话记录：${log}（父会话${on ? "在计划模式" : "不在计划模式"}）；${fork}`;
}
const STEPS = { AppendPlanOn: "进入计划模式", AppendPlanOff: "退出计划模式", AppendAnswer: "助手完成一次回答", ForkSession: "创建完整分支" };
export function step(action) { return STEPS[action] ?? action; }
