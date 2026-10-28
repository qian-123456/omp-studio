// 原生保护同步: 标签为简体中文，面向产品评审者。
export const readerActions = ["MarkNewEntry", "ResyncSame", "UserBreaksYml", "UserFixesYml", "SpawnOmp", "BeginTurn", "EndTurn", "RestartStale"];

function allowed(v) {
  return v.procUp && v.jsonProt && v.jsonVer === v.procEnv;
}
export function state(v, facts) {
  const yml = v.conflict ? (v.drift ? "密钥文件被手动改坏，应用还没发现" : "密钥文件被改坏，应用已发现") : (v.drift ? "密钥文件已改回，应用还没重写" : "密钥文件正常");
  const block = v.ymlBlock === 0 ? "文件里没有隐私块" : v.ymlBlock === v.ver ? "文件里是最新隐私块" : "文件里是旧隐私块";
  const proc = !v.procUp ? "没有运行中的会话进程" : v.procLoaded === v.ver ? "进程已加载最新保护" : "进程没有加载最新保护";
  const comp = !v.procUp ? "" : allowed(v) ? "，压缩被放行" : "，压缩被拦下";
  const turn = v.streaming ? "，正在回答" : "";
  return `${yml}，${block}，${proc}${comp}${turn}`;
}
const STEPS = {
  MarkNewEntry: "标记一个新的受保护值",
  ResyncSame: "改标签或关联会话，保护内容不变",
  UserBreaksYml: "用户手动把密钥文件改成非列表",
  UserFixesYml: "用户把密钥文件改回列表",
  SpawnOmp: "启动一个会话进程",
  BeginTurn: "发送消息开始回答",
  EndTurn: "回答结束",
  RestartStale: "保护内容变化后重启会话进程",
};
export function step(action, before, after) { return STEPS[action] ?? action; }
export function cause(v) {
  return v.drift
    ? "用户手动改过密钥文件后改回，应用还没重写，此时启动的会话进程没有加载隐私块，之后应用重写文件，摘要与进程一致，压缩被放行"
    : "原生保护写入失败时启动的会话进程拿到了正常摘要，之后写入恢复且摘要没变，压缩被放行，但这个进程从未加载过隐私块";
}
export function group(v) {
  return v.procUp && !v.drift && allowed(v) && v.procLoaded !== v.ver ? "压缩放行但进程未受保护" : "安全";
}
export const groupColors = { "压缩放行但进程未受保护": "#fde2e2", "安全": "#e2f5e9" };
