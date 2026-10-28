// AI 医生自动诊断图例。
export const readerActions = [];

const st = { idle: "未诊断", running: "诊断中", error: "诊断失败" };
export function state(v) {
	const one = (s) => (v.diag[s] ? "已诊断" : st[v.stat[s]]) + (v.tries[s] > 1 ? `（已尝试${v.tries[s] >= 3 ? "3次以上" : v.tries[s] + "次"}）` : "");
	return `较新会话：${one("A")}；较旧会话：${one("B")}`;
}

const STEPS = {
	Tick: "每分钟的自动检查开始一次诊断",
	DiagnoseOk: "诊断成功",
	DiagnoseFail: "诊断失败",
};
export function step(action) {
	return STEPS[action] ?? action;
}
export function cause(v, facts, inv) {
	return "失败不会写入诊断时间，下一分钟仍把同一个会话当作待诊断并排在最前";
}
