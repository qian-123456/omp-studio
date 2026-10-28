// 手机端连接横幅与事件流的图表标签（简体中文）。
export const readerActions = [
	"OfflineEvent", "OnlineEvent", "ServerRevokes", "EsSilentDeath", "Repair", "StartStream", "ApiUnauthorized",
];

const BANNER = {
	idle: "横幅：未连接",
	connecting: "横幅：连接中",
	open: "横幅：已连接",
	closed: "横幅：已断开",
	unauthorized: "横幅：配对失效",
};
const STREAM = { none: "无事件流", live: "事件流存活", dead: "事件流被系统杀死" };

export function state(v) {
	const net = v.netUp ? "网络在线" : "网络离线";
	const auth = v.tokenOk ? "配对有效" : "配对已撤销";
	const hello = v.helloPending ? "，等待问候" : "";
	const probe = v.probing ? "，探测中" : "";
	const timer = v.timer ? "，已排队重连" : "";
	return `${BANNER[v.phase]}: ${STREAM[v.es]}${hello}${probe}${timer}，${net}，${auth}`;
}

const STEPS = {
	ApiUnauthorized: "任一请求被服务器拒绝为未配对",
	EsError: "事件流出错或被服务器结束",
	EsSilentDeath: "系统悄悄杀掉事件流",
	HelloArrives: "收到服务器问候",
	OfflineEvent: "手机提示网络断开",
	OnlineEvent: "手机提示网络恢复",
	Probe401: "探测请求被拒绝为未配对",
	ProbeFailNet: "探测请求因网络失败",
	ProbeOk: "探测请求成功并建立事件流",
	Repair: "重新扫码配对成功",
	Resume: "页面回到前台",
	ServerRevokes: "电脑端撤销全部配对",
	StartStream: "应用启动事件流",
	TimerFires: "重连等待结束",
};
export function step(action) {
	return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
	if (invariant === "BannerMatchesStream") return "手机短暂提示断网但事件流其实没断，恢复网络后没有任何步骤把横幅改回已连接";
	if (invariant === "UnauthorizedSticky") return "断网提示无条件覆盖了配对失效提示";
	if (invariant === "OpenMeansStream") return "横幅显示已连接但既没有事件流也没有任何重连动作";
	return null;
}
