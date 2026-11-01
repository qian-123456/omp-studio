export const readerActions = ["setPerfOpen"];
export function state(v) {
 const n = v.memPromise.length;
 const panel = v.perfOpen ? "面板已开" : "面板已关";
 if (n > 1) return panel + "，双轮内存扫描";
 if (v.cancelled && v.memPromise.includes(1)) return panel + "，旧扫描未完成";
 return panel + (n ? "，一轮采样中" : "，没有采样在途");
}
const names = {pollClosed:"底栏启动内存采样",setPerfOpen:"点击性能打开面板",cleanup:"切换刷新周期，旧请求继续",pollOpen:"面板启动新一轮采样",completeClosed:"旧内存采样完成",completeOpen:"面板内存采样完成"};
export function step(action) { return names[action] ?? action; }
export function cause() { return "旧请求未完成，面板切换重置了防重入状态"; }
export const legend = {works:"当前路径正常",wrong:"当前代码发生并发扫描",fixed:"建议有效，产品未改"};
