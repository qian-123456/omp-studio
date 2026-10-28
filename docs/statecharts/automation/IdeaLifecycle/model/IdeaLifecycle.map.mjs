// 想法生命周期图例。
export const readerActions = ["UserSetStatus", "UserTrash", "UserRestore", "DialogClose", "DialogRetryOk", "DialogSendOk", "DialogSendStatusFail", "FillSendOk", "FillSendUpdateFail"];

const statusCN = { inbox: "待处理", dispatched: "已派发", done: "已完成", closed: "已关闭" };

export function state(v) {
	if (v.purged) return "已被永久删除";
	const where = v.trashed ? "在回收站" : statusCN[v.status];
	const extra = [];
	if (v.delivered && v.status === "inbox" && !v.retry) extra.push("已送达却仍显示待处理且无提示");
	if (v.retry) extra.push("已送达，对话框等待重试");
	if (v.stale) extra.push("超过30天未变动");
	if (v.trashed && v.trashOld) extra.push("入回收站超过7天");
	if (v.userRestored) extra.push("刚恢复");
	return extra.length ? `${where}（${extra.join("，")}）` : where;
}

const STEPS = {
	DialogSendOk: "在派发对话框发送成功",
	DialogSendStatusFail: "发送成功但记录已派发失败",
	DialogRetryOk: "点重试，记录已派发成功",
	DialogClose: "关闭派发对话框",
	FillSendOk: "放进输入框并发送成功",
	FillSendUpdateFail: "放进输入框并发送，记录已派发失败",
	UserSetStatus: "手动改变想法状态",
	UserTrash: "删除到回收站",
	UserRestore: "从回收站恢复",
	AgeFinished: "时间过去30天",
	AgeTrash: "回收站里过去7天",
	AppStart: "重新启动应用",
};
export function step(action) {
	return STEPS[action] ?? action;
}
export function cause(v, facts, inv) {
	if (inv === "DeliveredIsRecorded") return v.retry === false ? "已发送，但记录已派发的操作失败后没有留下任何重试或提示" : null;
	if (inv === "RestoredStaysRestored") return "恢复只清除删除时间，不刷新最后修改时间，下次启动又被当作超过30天的已结束想法放回回收站";
	return null;
}
