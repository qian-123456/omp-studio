export const readerActions = ["CreatePairing", "VisitPair", "RevokeAll", "PhoneViews", "PhoneClosesStream", "Subscribe", "OpenStream", "ApprovalRaised"];
const C = { none: "无配对码", fresh: "配对码有效", used: "配对码已用", expired: "配对码已过期" };
const T = { none: "无已配对设备", phone: "手机已配对", preview: "链接预览已拿到令牌" };
export function state(v) {
	return `${T[v.tokenOwner]}: ${C[v.code]}，${v.stream === "live" ? "事件流在线" : "无事件流"}，${v.subscribed ? "已订阅通知" : "未订阅通知"}${v.phoneViewing ? "，正在前台查看" : ""}${v.recent ? "，30秒内已通知" : ""}，已推送${v.pushed}次`;
}
const S = {
	CreatePairing: "电脑生成配对码", ExpireCode: "五分钟过期", RevokeAll: "电脑撤销全部配对",
	OpenStream: "手机打开事件流", EndStreamRevoked: "服务器发现令牌失效并结束事件流",
	PhoneClosesStream: "手机离开前台", Subscribe: "手机开启通知", PhoneViews: "手机在前台查看会话",
	ApprovalRaised: "会话进入等待审批", ThirtySeconds: "三十秒过去",
};
export function step(a, b, c) {
	if (a === "VisitPair") return c.tokenOwner === "phone" ? "手机打开配对链接" : "链接预览抢先打开配对链接";
	return S[a] ?? a;
}
export function cause(v, f, inv) {
	return {
		OnlyPhonePairs: "打开配对链接这个无需登录的 GET 请求就会兑换配对码，任何访问者都能拿到令牌",
		CodeSingleUse: "配对码被兑换多次",
		RevokedHasNoSubscription: "撤销后订阅仍在",
		NoPushWhileViewing: "手机从不上报自己正在查看哪个会话，服务器无法跳过这次推送",
		NoApprovalDropped: "三十秒内的第二个审批请求被当作重复通知丢弃，订阅的手机收不到",
	}[inv];
}
