// Chart labels for the plan stop/reminder model (Chinese reader words).
export const readerActions = ["SendMessage", "UserStopsTurn"];
export function state(v) {
	const run = v.turn === "idle" ? "空闲" : v.turn === "user" ? "正在回答你的消息" : "正在响应隐藏提醒";
	const file = v.planFileFound ? "计划文件已写出" : "还没有计划文件";
	return `${run}：${file}，已点停止${v.stopClicks}次`;
}
const STEPS = {
	SendMessage: "发送一条消息",
	ModelWritesPlan: "模型写出计划文件",
	ModelFinishes: "这一轮自然结束",
	UserStopsTurn: "点击停止",
};
export function step(action) {
	return STEPS[action] ?? action;
}
