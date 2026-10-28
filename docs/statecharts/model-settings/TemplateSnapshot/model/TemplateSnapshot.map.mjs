export const readerActions = ["Load", "Publish"];
export function state(v) {return `${v.snapshotInflight ? "快照读取中" : "读取已结束"}；显示${v.snapshot === "empty" ? "空白" : v.snapshot === "new" ? "新配置" : "旧配置"}；${v.committed ? "保存已确认" : "尚未保存"}`;}
export function step(s) {return ({Load:"开始读取模板列表",Publish:"保存模板并显示新配置",Resolve:"先前的读取返回配置",Fail:"先前的读取失败"})[s] ?? s;}
export function group(v) {return v.committed && v.snapshot !== "new" ? "保存被覆盖" : "正常";}
