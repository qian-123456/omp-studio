// Chart labels for SpaceFollow, for statechart.mjs. Write labels in the words of the person who reads
// the chart, not in variable or action names.
// v, before, and after map each variable to its value. Strings, numbers, and booleans keep their kind.
// Sequences and tuples, including functions over 1..n, read from 1 as in TLA+, so v.seat[1] is the
// first item. Reading index 0 stops the run. length, array methods, and spread still work. A
// method's index, such as indexOf or the i in map((x, i) => ...), still counts from 0.
// Sets become arrays. Records and other functions become objects.
// Variables: activeMode, selectedId, sidebarOpen, prevSelectedIdRef.

// The actions that the reader takes, by action name, when the chart separates what the reader does
// from what happens around the reader. facts.settled is true when only these are enabled. With
// --cover, the overview keeps only the shortest path to each settled state, plus every bug path.
// Leave it empty when every action counts the same.
export const readerActions = ["SelectSession", "ToggleSidebar", "UserSwitchMode"];

const modeName = (m) => (m === "CodeMode" ? "代码空间" : "研究空间");
const idMode = (id) => (id === "a" ? "CodeMode" : "ResearchMode");
const selName = (id) => (id === "none" ? "没有选中会话" : "选中了" + modeName(idMode(id)) + "的会话");

export function state(v, facts) {
	const bar = v.sidebarOpen ? "侧边栏展开" : "侧边栏收起";
	const shown = "侧边栏显示" + modeName(v.activeMode);
	const hidden = v.selectedId !== "none" && idMode(v.selectedId) !== v.activeMode;
	return bar + "，" + shown + ": " + selName(v.selectedId) + (hidden ? "，选中的行不在列表里" : "");
}

const STEPS = {
	SelectSession: "从收件箱等入口直接打开另一个会话",
	ToggleSidebar: "按下 Cmd+B 展开或收起侧边栏",
	UserSwitchMode: "在侧边栏里手动切换空间",
};
export function step(action, before, after) {
	return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
	return "侧边栏收起期间打开了另一个空间的会话，重新展开后不会补做空间跟随";
}

export const legend = { works: "空间与选中会话一致", wrong: "选中的会话在看不见的空间里", fixed: "修复后一致" };
