// Chart labels for the held-queue model (Chinese reader words).
const list = (a) => (a.length ? a.join("、") : "无");
export const readerActions = ["TypeWhileStreaming", "UserStop", "SendOneStarts", "DeleteQueued", "FreshTurnStarts"];
export function state(v) {
	const run = v.streaming ? (v.stopRequested ? "正在停止" : "正在生成") : "空闲";
	const sent = Object.entries(v.delivered).filter(([, n]) => n > 0).map(([k]) => k);
	const flight = [v.batchItems.length ? `合并发送中：${list(v.batchItems)}` : "", v.queuedBusy.length ? `单条发送中：${list(v.queuedBusy)}` : ""].filter(Boolean).join("；");
	return `${run}：暂存${list(v.queues)}；已发出${list(sent)}${flight ? "；" + flight : ""}`;
}
const STEPS = {
	TypeWhileStreaming: "生成中输入一条消息，先暂存",
	UserStop: "点击停止",
	TurnEnds: "这一轮结束",
	BatchSendSucceeds: "合并消息发送成功",
	BatchSendFails: "合并消息发送失败，退回队列",
	SendOneStarts: "点击立即发送其中一条",
	SendOneSucceeds: "单条发送成功",
	SendOneFails: "单条发送失败，仍留在队列",
	DeleteQueued: "确认删除一条暂存消息",
	FreshTurnStarts: "直接发送新消息开始一轮",
};
export function step(action) {
	return STEPS[action] ?? action;
}
