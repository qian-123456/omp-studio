export const readerActions = ["UserOpenForkDraft", "UserNewSession", "UserCloseForkDraft", "UserSelectRealSession"];
export function state(v, facts) {
	const shown = v.forkDraftOpen ? "中间显示分支草稿" : v.pendingSelected ? "中间显示新会话草稿" : "中间显示起始页";
	const last = { none: "刚打开", newSession: "用户刚点了新建会话", fork: "用户刚点了分支", realSession: "用户刚选了已有会话" }[v.lastRequest];
	return shown + ": " + last + (v.forkDraftOpen && v.pendingSelected ? "，新会话草稿被盖住" : "");
}
const STEPS = {
	UserOpenForkDraft: "在运行中的会话上点分支",
	UserNewSession: "按 Cmd+N 或点新建会话",
	UserCloseForkDraft: "放弃分支草稿",
	UserSelectRealSession: "点一个已有会话",
};
export function step(action, before, after) { return STEPS[action] ?? action; }
export function cause(v, facts, invariant) { return "分支草稿一直开着，新建会话草稿虽然建好了却被它盖住"; }
export const legend = { works: "显示的就是用户要的", wrong: "新建会话被分支草稿盖住", fixed: "修复后显示新会话" };
