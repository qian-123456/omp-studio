export const readerActions=["Preview","Apply","Undo","ExternalEdit","LaterEdit"];
export function state(v){return `${({overview:"扫描总览",plan:"替换预览",results:"替换结果"})[v.step]}；当前${({A:"原模型",B:"目标模型",C:"手动模型"})[v.value]}；${v.record ? "有历史" : "无历史"}；${v.direction==="undo" ? (v.ok ? "已恢复" : "已跳过撤销") : v.scanStale ? "需重新扫描" : "可继续"}`;}
export function step(s){return ({Preview:"选择原模型并查看预览",ExternalEdit:"外部修改当前值",Apply:"提交替换并记录成功项",LaterEdit:"替换后手动修改",Undo:"撤销历史中的成功项"})[s]??s;}
