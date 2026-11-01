export const readerActions=[];
export function state(v) {
 if(v.memoryInfo !== "none") return v.memoryInfo === v.perfData ? "刷新完成，两处内存一致" : "刷新完成，两处内存不一致";
 if(v.memPromise === "pending" && v.perfPromise === "pending") return "底栏和面板等待独立采样";
 if(v.memPromise === "pending") return "面板采样已返回，等待底栏";
 if(v.perfPromise === "pending") return "底栏采样已返回，等待面板";
 return v.memPromise === v.perfPromise ? "两份采样返回，数值相同" : "两份采样返回，数值不同";
}
const names={getAppMemoryUsage:"底栏独立采样返回",perfBreakdown:"面板独立采样返回",poll:"刷新底栏与面板"};
export function step(action){return names[action] ?? action;}
export function cause(){return "底栏和面板使用不同时间的独立采样";}
export const legend={works:"当前路径正常",wrong:"两处内存不一致",fixed:"建议有效，产品未改"};
