export const readerActions = ["UserOpenSession", "UserTakeover"];
const NAME = { live: "由本应用运行", external: "显示被外部终端占用", suspended: "显示已挂起", idle: "显示空闲" };
export function state(v) {
  const holder = v.statusFile === "working" ? (v.pidAlive ? (v.pidIsOmp ? "，状态文件指向运行中的终端" : "，状态文件的进程号已被无关程序占用") : "，状态文件指向已死进程") : "";
  return `${NAME[v.meta.st]}${holder}${v.stopPending ? "，挂起标记待写" : ""}`;
}
export function group(v) { return v.meta.st === "external" ? "显示外部占用" : "其他显示"; }
export const groupColors = { "显示外部占用": "#fdebd0", "其他显示": "#e8f6e8" };
const S = { ExternalOmpStarts: "终端启动 omp", ExternalOmpExitsCleanly: "终端 omp 正常退出", ExternalOmpKilled: "被记录的进程被强制关闭",
  PidReusedByOtherProgram: "系统把该进程号分给无关程序", ExternalCheckLoop: "周期检查刷新显示", UserOpenSession: "点击继续会话",
  UserTakeover: "点击接管", IdleReclaim: "空闲回收关闭进程", ExitEventRecompute: "退出事件刷新显示", WriteSuspendedFlag: "写入挂起标记" };
export function step(a) { return S[a] ?? a; }
export function cause(v, f, inv) {
  if (inv === "ExternalIsRealOmp") return "终端被强杀后状态文件没有改成已退出，进程号又被无关程序复用，只靠进程号存活就判为外部占用";
  if (inv === "SuspendShown") return "挂起标记写入时不触发刷新，进程退出的刷新先发生，显示停在空闲";
  return null;
}
