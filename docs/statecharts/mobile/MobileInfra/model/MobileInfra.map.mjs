export const readerActions = ["StartServer", "StopServer", "TunnelStartBegin", "TunnelStop", "Ipv6Start", "Ipv6Stop", "SetDdnsHost"];
export function state(v) {
	const t = v.tunnel === "up" ? "隧道在线" : v.inflight ? "隧道启动中" : "无隧道";
	const h = (x) => (x === "none" ? "无" : x === "A" ? "域名甲" : "域名乙");
	return `${v.server === "running" ? "服务运行" : "服务停止"}: ${t}，进程${v.children}个${v.inflight > 1 ? "，两次启动同时进行" : ""}，${v.v6 === "on" ? `IPv6在线，证书域名${h(v.certHost)}` : "IPv6关闭"}，设置域名${h(v.ddnsHost)}，已同步${h(v.ddnsSynced)}`;
}
const S = {
	StartServer: "启动手机服务", StopServer: "停止手机服务", TunnelStartBegin: "点开始隧道",
	TunnelReady: "隧道地址就绪", TunnelStartTimeout: "等待隧道地址超时", TunnelStop: "点停止隧道",
	Ipv6Start: "启动 IPv6 服务", Ipv6Stop: "停止 IPv6 服务", SetDdnsHost: "修改 DDNS 域名", DdnsSync: "后台同步域名成功",
};
export function step(a) { return S[a] ?? a; }
export function cause(v, f, inv) {
	return {
		TunnelNeedsServer: "停止服务时只终止已登记的隧道，启动中的隧道之后仍会登记成功",
		NoOrphanTunnel: "两次启动都成功后只登记最后一个，停止时另一个进程无人管理",
		LinkCoveredByCert: "运行中的 IPv6 服务不会因域名变化重新生成证书，但页面已改用新域名",
	}[inv];
}
