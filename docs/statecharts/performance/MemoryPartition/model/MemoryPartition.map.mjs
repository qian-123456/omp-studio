export const readerActions=[];
export function state(v) {
 if(v.other_bytes !== -1) return v.app+v.bar_omp_bytes+v.other_bytes+v.free_bytes === v.total_bytes ? "分布已出，总和等于整机" : "分布已出，总和超过整机";
 if(v.used_bytes === -1) return "等待整机内存采样";
 if(v.bar_omp_bytes === -1) return "整机已采样，等待进程";
 return v.app+v.bar_omp_bytes <= v.used_bytes ? "进程已采样，未超整机已用" : "后采进程，占用已增长";
}
const names={system_memory:"先读取整机已用内存",footprints_for:"随后读取各进程内存",collect:"其余内存不足时按零计算"};
export function step(a){return names[a] ?? a;}
export function cause(){return "较晚的进程采样超过较早的整机已用，负差额被截为零";}
export const legend={works:"该输入下计算一致",wrong:"模型命中，尚未实机复现"};
