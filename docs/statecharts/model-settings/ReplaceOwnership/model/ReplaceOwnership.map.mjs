export const readerActions=["Start","Leave"];
export function state(v){return `${({preview:"替换预览",overview:"已返回总览",results:"显示替换结果"})[v.step]}；${v.writesInFlightRef?"写入进行中":"没有进行中的写入"}${v.scanStale?"；扫描已过期":""}${v.rescanPendingRef?"；等候重扫":""}${v.error?"；显示写入错误":""}`;}
export function step(s){return ({Start:"提交替换",Leave:"返回总览并放弃本轮结果",Complete:"写入成功返回",Fail:"写入失败返回",Scan:"写入结束后重新扫描"})[s]??s;}
