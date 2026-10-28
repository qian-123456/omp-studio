export const readerActions = ["UserSendFromDraft", "UserOpenSettings", "UserCloseSettings", "UserLeaveToPage"];

export function state(v, facts) {
	const where = v.centerView === "settings" ? "设置窗口开着（下面是新会话页）" : v.centerView === "home" ? "已经去了别的页面" : "停在新会话页";
	let draft = v.handoff === "idle" ? "还没发送" : v.handoff === "inflight" ? "已按回车，进程启动中" : "发送已完成";
	let see = "";
	if (v.handoff === "done") see = v.selectedSessionId === "real" ? "，已进入刚发送的会话" : "，没有进入刚发送的会话";
	return where + ": " + draft + see;
}

const STEPS = {
	UserSendFromDraft: "在新会话里按回车发送第一条消息",
	UserOpenSettings: "打开设置窗口",
	UserCloseSettings: "关闭设置窗口",
	UserLeaveToPage: "切到收件箱等其他页面",
	HandoffComplete: "进程启动完成，草稿转成真实会话",
};
export function step(action, before, after) {
	return STEPS[action] ?? action;
}
export function cause(v, facts, invariant) {
	return "进程启动完成时设置窗口正开着，系统不认为用户还停在新会话页，所以没有选中新会话，草稿也被删除";
}
export const legend = { works: "发送后看到了新会话", wrong: "发送后落到空白起始页", fixed: "修复后看到了新会话" };
