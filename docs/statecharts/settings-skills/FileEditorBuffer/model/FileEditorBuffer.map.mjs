// Chart labels for FileEditorBuffer, for statechart.mjs. Write labels in the words of the person who reads
// the chart, not in variable or action names.
// v, before, and after map each variable to its value. Strings, numbers, and booleans keep their kind.
// Sequences and tuples, including functions over 1..n, read from 1 as in TLA+, so v.seat[1] is the
// first item. Reading index 0 stops the run. length, array methods, and spread still work. A
// method's index, such as indexOf or the i in map((x, i) => ...), still counts from 0.
// Sets become arrays. Records and other functions become objects.
// Variables: disk, stamp, loaded, draft, saving, saveText, conflict, reloading, userWants, nextId.

// The actions that the reader takes, by action name, when the chart separates what the reader does
// from what happens around the reader. facts.settled is true when only these are enabled. With
// --cover, the overview keeps only the shortest path to each settled state, plus every bug path.
// Leave it empty when every action counts the same.
export const readerActions = ["TypeText", "SaveStart", "ReloadStart", "Discard", "ConflictOverwrite", "ConflictReload", "ExternalWrite"];

// The label for one model state. facts.enabled is the set of actions the state enables,
// including steps that change no variable. A label "context: progress", such as
// "Primary down: write queued", puts the states of one context in one box, and can draw the
// overview as two parallel regions. Use that form only when the context and the progress change
// independently. A label without ": " draws each state on its own.
// Do not claim a result that a pending step can still change, such as "write lost" while a
// retry is still queued.
export function state(v, facts) {
	const busy = v.conflict ? "出现保存冲突框" : v.saving ? "正在保存" : v.reloading ? "正在重新读取" : "空闲";
	const dirty = v.draft !== v.loaded ? "有未保存修改" : "没有未保存修改";
	const ext = v.stamp !== v.disk ? "，磁盘已被外部改动" : "";
	const typed = v.userWants !== 0 && v.draft !== v.userWants ? "，用户后敲的字已消失" : "";
	return `${busy}: ${dirty}${ext}${typed}`;
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
	ConflictOverwrite: "选择覆盖",
	ConflictReload: "选择重新读取",
	Discard: "点放弃修改",
	ExternalWrite: "其他程序改了文件",
	ReloadDone: "读取结果返回",
	ReloadStart: "点重新读取",
	SaveConflicts: "保存被拒绝",
	SaveStart: "点保存",
	SaveSucceeds: "保存成功返回",
	TypeText: "继续输入文字",
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
