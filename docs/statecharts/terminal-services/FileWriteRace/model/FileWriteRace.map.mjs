// 文本文件并发保存图的中文标签。
export const readerActions = ["WriteTmp1", "WriteTmp2", "Rename1", "Rename2"];
const W = { idle: "尚未开始", tmpWritten: "已写好临时文件", ok: "报告保存成功", failed: "报告保存失败" };
export function state(v) {
  const f = { old: "文件仍是旧内容", c1: "文件是第一次保存的内容", c2: "文件是第二次保存的内容" }[v.file];
  return `第一次保存${W[v.w1]}，第二次保存${W[v.w2]}，${f}`;
}
export function group(v) {
  const done = ["ok", "failed"].includes(v.w1) && ["ok", "failed"].includes(v.w2);
  if (done && ((v.w1 === "failed" && v.file === "c1") || (v.w2 === "failed" && v.file === "c2") || (v.w1 === "ok" && v.w2 === "failed" && v.file !== "c1") || (v.w2 === "ok" && v.w1 === "failed" && v.file !== "c2"))) return "结果与回报矛盾";
  if (done) return "两次保存都结束";
  return "保存进行中";
}
export const groupColors = { "两次保存都结束": "#d1f2eb", "保存进行中": "#e8f0fe" };
const STEPS = {
  WriteTmp1: "第一次保存写入临时文件",
  WriteTmp2: "第二次保存写入临时文件",
  Rename1: "第一次保存替换目标文件",
  Rename2: "第二次保存替换目标文件",
};
export function step(a) { return STEPS[a] ?? a; }
export function cause(v, facts, inv) {
  return "两次保存使用同一个临时文件名，后写的内容覆盖了前一次的临时文件，先替换的一方把另一方的内容放进了目标文件，后替换的一方因临时文件已被搬走而失败";
}
export const legend = { works: "与规则一致", wrong: "违反规则" };
