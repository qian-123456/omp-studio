export const readerActions=["ChooseProject","ChooseGlobal","DeleteGlobal","SetProject"];
export function state(v){return `${v.table==="role"?"角色分配":"点名覆盖"}；${v.scope==="global"?"全局页":"项目页"}；全局${v.global==="none"?"未设置":"已设置"}；项目${v.project==="none"?"未设置":"已设置"}；${v.phase==="unread"?"等待读取":v.effective==="none"?"继续下级来源":v.effective==="G"?"采用全局值":"采用项目值"}`;}
export function step(s){return ({ChooseProject:"切换到项目范围",ChooseGlobal:"切换到全局范围",Resolve:"读取并解析当前范围",DeleteGlobal:"删除全局配置项",SetProject:"设置项目配置项"})[s]??s;}
