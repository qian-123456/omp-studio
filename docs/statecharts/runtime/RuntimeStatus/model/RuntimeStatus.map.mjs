// 运行状态模型的图标签 (中文, 面向读者)。
const ST = {
  working: "处理中", awaitingApproval: "等待批准", awaitingAnswer: "等待回答", review: "待查看结果",
  error: "出错", idle: "空闲", external: "被外部终端占用", suspended: "已挂起", interrupted: "被中断",
};
export const readerActions = ["UserStartProcess", "UserPrompt", "UserRespond", "UserAccept"];

export function state(v, facts) {
  const proc = v.childAlive
    ? (v.childTurn ? "进程在跑回合" : v.childAsync ? "进程空闲等后台任务" : "进程空闲")
    : (v.registry ? "进程已退出但句柄未清" : "没有进程");
  const flight = v.stdout.length + v.bus.length;
  const ui = (v.feStreaming ? "，界面转圈" : "") + (v.feUi.length ? "，界面有待答卡片" : "");
  const fl = flight ? `，${flight}条消息在途` : "";
  return `会话显示「${ST[v.meta.st]}」${v.meta.live ? "（仍记为存活）" : ""}: ${proc}${ui}${fl}`;
}

export function group(v) {
  if (v.meta.st === "working" || v.meta.st.startsWith("awaiting")) return "显示进行中或等待";
  if (v.meta.st === "review" || v.meta.st === "error" || v.meta.st === "interrupted") return "显示待处理结果";
  return "显示空闲类状态";
}
export const groupColors = { "显示进行中或等待": "#fdebd0", "显示待处理结果": "#d6eaf8", "显示空闲类状态": "#e8f6e8" };

const STEPS = {
  UserStartProcess: "点击继续，拉起进程",
  UserPrompt: "发送消息",
  UserRespond: "回答卡片",
  UserAccept: "标记已读",
  ChildStartTurn: "进程开始一轮",
  ChildAsk: "进程请求批准或回答",
  ChildCancelUi: "进程撤销请求",
  ChildEndTurn: "进程写出正常结束",
  ChildEndWithError: "进程写出出错结束",
  ChildEndAwaitingAsync: "进程写出结束并等待后台任务",
  ChildEndScheduledContinuation: "进程写出计划续跑的结束",
  ChildExit: "进程退出",
  DeliverStart: "读到开始帧",
  DeliverAsk: "读到请求帧",
  DeliverCancel: "读到撤销帧",
  DeliverEnd: "读到结束帧",
  DeliverEndAwaitingAsync: "读到等待后台的结束帧",
  DeliverEndContinuation: "读到续跑结束帧",
  MonitorEmitExit: "监视器宣告进程退出",
  MonitorUnregister: "监视器移除句柄",
  ConsumeAgentStart: "状态推导处理开始",
  ConsumeAsk: "状态推导处理请求",
  ConsumeCancel: "状态推导处理撤销",
  ConsumeAgentEnd: "状态推导处理结束",
  ConsumeContinuation: "状态推导忽略续跑结束",
  ConsumeProcessUp: "状态推导处理进程启动",
  ConsumeProcessExit: "状态推导处理进程退出",
  ConsumePrompt: "状态推导处理发送",
  ConsumeAccepted: "状态推导处理已读",
  ConsumeResponded: "状态推导处理回答",
  FileRefresh: "监听到会话文件变化",
  ExternalOpens: "外部终端占用会话",
  ExternalCloses: "外部终端释放会话",
  IdleSuspend: "空闲回收关闭进程",
};
export function step(action) { return STEPS[action] ?? action; }

export function cause(v, facts, invariant) {
  if (invariant === "NoGhostLive") return "退出事件、注册表清理与遗留帧没有共同的完成屏障，缓存仍记会话存活";
  if (invariant === "NoGhostStreaming") return "进程退出之后界面又收到该进程遗留的开始帧，转圈再也不会停";
  if (invariant === "CardsMatchStatus") return "回合结束后待答卡片仍保留，但会话状态已不再是等待";
  if (invariant === "IdleNotWorking") return "回合结束后仍可回答保留的卡片，回答让空闲会话直接变成处理中";
  if (invariant === "AwaitingNeedsProcess") return "迟到的请求帧让已退出的会话重新显示等待用户";
  if (invariant === "BadExitShowsError") return "旧出错标记被较新的转录活动覆盖，非零退出未刷新相同的出错标记";
  return invariant;
}
