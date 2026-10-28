// Chart labels for the side chat model (Chinese reader words).
export const readerActions = ["ClickSend", "StartHandback"];
export function state(v) {
	const tab = v.tab === "blank" ? "空白辅助对话页" : v.tab === "creating" ? "正在创建辅助对话" : "辅助对话已绑定";
	const msg = v.echoBubble ? (v.askState === "failed" ? "，界面显示已发消息但发送失败" : v.askState === "sent" ? "，首条消息已发出" : "，首条消息发送中") : v.pendingBubble ? "，显示待发气泡" : "";
	const input = v.questionDraft === "typed" ? "，输入框有文字" : "，输入框为空";
	const plan = v.forkSession ? (v.forkPlanOn ? "，副本带着计划模式" : "，副本未带计划模式") : "";
	const hb = v.handback === "idle" ? "" : v.handback === "running" ? "，正在整理结论" : v.handback === "ready" ? "，结论已就绪" : "，整理结论失败";
	return `${tab}${msg}${input}${plan}${hb}`;
}
const STEPS = {
	ClickSend: "点击发送首条消息",
	CreateFails: "创建辅助对话失败",
	CreateOk: "辅助对话创建成功",
	CutCopyWriteFails: "裁剪副本写入失败",
	AskSucceeds: "首条消息发送成功",
	AskFails: "首条消息发送失败",
	SideTurnEnds: "辅助对话这一轮结束",
	StartHandback: "点击回传给父会话",
	HandbackFinishes: "整理结论结束",
};
export function step(action) {
	return STEPS[action] ?? action;
}
