// 剪贴板文件缓存重名图的中文标签。
export const readerActions = ["Save1", "Save2"];
export function state(v) {
  const t = v.sameKey ? "两个文件同一毫秒且同名" : "两个文件的缓存名不同";
  const s = (x) => (x === "done" ? "已保存" : "未保存");
  const d = v.sameKey
    ? `共用路径里是${{ none: "空", c1: "第一个文件", c2: "第二个文件" }[v.disk.shared]}`
    : `两个路径各自保存`;
  return `${t}，第一个文件${s(v.s1)}，第二个文件${s(v.s2)}，${d}`;
}
export function group(v) {
  if (v.s1 === "done" && v.s2 === "done" && v.sameKey) return "两个附件指向同一路径";
  return "各自独立";
}
export const groupColors = { "各自独立": "#d1f2eb" };
const STEPS = { Save1: "保存第一个粘贴文件", Save2: "保存第二个粘贴文件" };
export function step(a) { return STEPS[a] ?? a; }
export function cause() {
  return "缓存文件名只由毫秒时间戳和文件名拼成且不检查是否已存在，同一毫秒的同名文件会互相覆盖，两个附件指向同一路径";
}
export const legend = { works: "与规则一致", wrong: "违反规则" };
