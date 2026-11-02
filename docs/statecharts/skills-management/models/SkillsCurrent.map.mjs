// Chart labels for SkillsCurrent, for statechart.mjs. Write labels in the words of the person who reads
// the chart, not in variable or action names.
// v, before, and after map each variable to its value. Strings, numbers, and booleans keep their kind.
// Sequences and tuples, including functions over 1..n, read from 1 as in TLA+, so v.seat[1] is the
// first item. Reading index 0 stops the run. length, array methods, and spread still work. A
// method's index, such as indexOf or the i in map((x, i) => ...), still counts from 0.
// Sets become arrays. Records and other functions become objects.
// Variables: catalog, path, trashingDirs, loading, error, deleteAnchor, dir, success, pc.

// The actions that the reader takes, by action name, when the chart separates what the reader does
// from what happens around the reader. facts.settled is true when only these are enabled. With
// --cover, the overview keeps only the shortest path to each settled state, plus every bug path.
// Leave it empty when every action counts the same.
export const readerActions = ["OpenDelete", "CancelDelete", "ConfirmDelete"];

// The label for one model state. facts.enabled is the set of actions the state enables,
// including steps that change no variable. A label "context: progress", such as
// "Primary down: write queued", puts the states of one context in one box, and can draw the
// overview as two parallel regions. Use that form only when the context and the progress change
// independently. A label without ": " draws each state on its own.
// Do not claim a result that a pending step can still change, such as "write lost" while a
// retry is still queued.
export function state(v) {
  const count = v.catalog.length;
  const where = count ? `列表显示 ${count} 个来源` : "列表不再显示该技能";
  if (v.pc === "confirm") return `${where}，等待确认移除`;
  if (v.pc === "trash") return `${where}，正在移除当前副本`;
  if (v.pc === "reload") return `${where}，副本已移走，已提示成功`;
  if (v.pc === "loading") return `${where}，正在重新扫描`;
  if (v.pc === "finish") return `${where}，${v.error === "refresh" ? "刷新失败，正在结束操作" : v.error === "trash" ? "移除失败，正在结束操作" : "扫描完成，正在结束操作"}`;
  if (v.error === "refresh") return `${where}，${v.catalog.includes(v.dir) ? "已移走的目录仍在，操作已结束" : "副本已移除，列表待刷新"}`;
  if (v.error === "trash") return `${where}，移除失败，可重试`;
  return `${where}，${v.success ? "移除成功" : "尚未移除"}`;
}

// The names of the two parallel regions, when the overview draws them: contexts, then progress.
// export const regionNames = ["Primary", "Write"];

// The group of one model state, in the reader's words, such as "Order shipped". The chart fills
// the states of one group with one color, and the legend names the groups. TLC still decides
// which states break a rule, and draws them with a thick red border on top of the group color.
// groupColors gives a group a light color. Groups without one take a palette color.
// export function group(v, facts) {}
// export const groupColors = { "Order shipped": "#d1f2eb" };

// The label for one step. A step that leaves the reader in the same state is not drawn,
// unless the reader takes it on a bug path. "" draws no label, and a numbered bug step shows the action.
// action is the action's name without its parameters, so compare before and after to tell which
// process or item the step changed.
// STEPS lists every definition that changes a variable. TLC names no step after one that another
// action uses in its /\ list, such as Log in Save == Log /\ saved' = TRUE, so delete its entry.
const STEPS = {
  OpenDelete: "点击移除",
  CancelDelete: "取消",
  ConfirmDelete: "确认仅移除当前副本",
  TrashSucceeded: "系统移走当前副本并提示成功",
  TrashFailed: "系统未能移走副本",
  LoadCatalog: "开始刷新列表",
  LoadSucceeded: "扫描成功，展示剩余副本",
  LoadFailed: "扫描失败",
  FinishDelete: "结束操作并解除忙碌状态",
};
export function step(action, before, after) {
	return STEPS[action] ?? action;
}

// When the step can happen, in plain words, such as "after the lease expires". The chart shows
// "step [words]". "" adds nothing.
// export function guard(action, before, after) {}

// For a timer step, how many seconds the code waits, from the constant in the code. The chart
// shows "after N s, step". Return nothing for other steps.
// export function timer(action, before, after) {}

// Why a bad state is bad, in the reader's words, such as "a worker crashed after it took the job,
// and no other worker can take it". No variable, function, or event names.
// Counterexamples that break one rule with one cause are one bug, so two bugs that end in the
// same state stay apart only if their causes differ. Return null to group by the end state.
// export function cause(v, facts, invariant) {}

// The developer's words for one model state. With it, each bug is also drawn through these states.
// export function detail(v, facts) {}

// The legend's words for each status, in place of the defaults. Group entries keep their names.
// export const legend = { works: "Works on main", wrong: "Wrong on main", fixed: "Fixed in the open PR" };
export function cause() { return "副本移走后扫描失败，旧目录未从列表失效"; }
