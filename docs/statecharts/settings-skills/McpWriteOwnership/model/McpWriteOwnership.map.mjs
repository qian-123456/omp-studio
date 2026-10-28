export const readerActions = ['OpenEditor','OpenImport','CloseChild','EditorSubmit','ImportSubmit','InlineAct'];
export function state(v) { return `${v.emptyCatalog?'目录为空':'目录有服务器'}：${v.dialog==='none'?'没有弹窗':v.dialog==='editor'?'编辑弹窗':'导入弹窗'}${v.localBusy?'（本窗口正在保存）':''}，${v.writes}次写入尚未返回`; }
const steps={OpenEditor:'点添加服务器',OpenImport:'点导入',CloseChild:'关闭弹窗但请求未取消',EditorSubmit:'保存合法草稿',ImportSubmit:'导入合法条目',InlineAct:'点行内配置开关'};
export function step(a){return steps[a]??a;}
