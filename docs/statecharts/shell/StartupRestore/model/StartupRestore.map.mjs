export const readerActions = ["UserOpenPage"];
export function state(v, facts) {
	const page = { home: "停在首页", settings: "设置窗口开着", inbox: "停在收件箱", session: "已进入上次的会话" }[v.centerView];
	const load = v.hasLoaded ? (v.restoredRef ? "会话列表已加载，恢复已处理" : "会话列表已加载") : "会话列表加载中";
	return page + ": " + load + (v.overridden ? "，用户打开的页面被抢走" : "");
}
const STEPS = {
	UserOpenPage: "加载没完成时自己打开设置或收件箱",
	FirstLoadSucceeds: "会话列表第一次加载成功",
	RestoreEffect: "启动恢复上次的会话",
};
export function step(action, before, after) { return STEPS[action] ?? action; }
export function cause(v, facts, invariant) { return "启动恢复只看会话是否加载完，不看用户已经去了别的页面"; }
export const legend = { works: "页面没被抢走", wrong: "用户打开的页面被抢走", fixed: "修复后保留用户的页面" };
