import { useCallback, useEffect, useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { ActionButton, Row, Switch } from "../controls";
import { Chip, toast } from "../../../ui";
import { errorMessage } from "../../../core/api";
import { usePrefs } from "../../../core/stores/prefs";
import {
	currentSubscription,
	disablePush,
	enablePush,
	pushCapability,
	readPushEnv,
	sendTestPush,
	type PushCapability,
} from "../push";

export function NotifySheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const sound = usePrefs((s) => s.notifySound);
	const flash = usePrefs((s) => s.titleFlash);
	const set = usePrefs((s) => s.set);
	const [cap, setCap] = useState<PushCapability>(() => pushCapability(readPushEnv()));
	const [subscribed, setSubscribed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [turnEnd, setTurnEnd] = useState(true);
	const [approval, setApproval] = useState(true);
	const [exit, setExit] = useState(true);

	const refresh = useCallback(async () => {
		const env = readPushEnv();
		setCap(pushCapability(env));
		setSubscribed(await currentSubscription(env));
	}, []);

	useEffect(() => {
		if (open) {
			void refresh();
		}
	}, [open, refresh]);

	const onTogglePush = useCallback(
		async (next: boolean) => {
			if (busy) return;
			setBusy(true);
			try {
				if (next) {
					await enablePush();
					toast("已启用手机后台推送通知", { kind: "success" });
				} else {
					await disablePush();
					toast("已停用手机后台推送通知", { kind: "info" });
				}
			} catch (e) {
				toast(`${next ? "开启" : "关闭"}失败：${errorMessage(e)}`, { kind: "error" });
			} finally {
				await refresh();
				setBusy(false);
			}
		},
		[busy, refresh],
	);

	const onTest = async () => {
		setBusy(true);
		try {
			await sendTestPush();
			toast("测试推送已发出，请查看系统通知", { kind: "success" });
		} catch (e) {
			toast(`发送失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	const canToggle = cap.available || (subscribed && cap.block === "denied");

	return (
		<BottomSheet open={open} onClose={onClose} title="通知设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">通知触发场景</div>

					<Row name="回答完成时提醒" hint="AI 思考与生成完毕、结束一轮对话时通知我">
						<Switch label="回答完成时提醒" checked={turnEnd} onChange={setTurnEnd} />
					</Row>

					<Row name="等待审批时提醒" hint="智能体等待你确认工具调用或文件写入时提醒">
						<Switch label="等待审批时提醒" checked={approval} onChange={setApproval} />
					</Row>

					<Row name="会话异常退出时提醒" hint="进程意外退出或服务中断时发出告警通知">
						<Switch label="会话异常退出时提醒" checked={exit} onChange={setExit} />
					</Row>

					<Row name="提示音" hint="页面打开时，会话需要你处理就响一声">
						<Switch label="提示音" checked={sound} onChange={(v) => set({ notifySound: v })} />
					</Row>

					<Row name="标题闪烁" hint="页面在后台时，让浏览器标签标题闪烁提醒">
						<Switch label="标题闪烁" checked={flash} onChange={(v) => set({ titleFlash: v })} />
					</Row>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center justify-between">
						<div className="text-m-xs font-semibold text-m-text">Web Push 手机推送</div>
						<Chip tone={cap.available ? "success" : cap.block === "insecure" ? "warn" : "neutral"}>
							{cap.available
								? "支持推送"
								: cap.block === "insecure"
									? "需 HTTPS / 局域网安全源"
									: cap.block === "denied"
										? "权限被拒"
										: "不支持"}
						</Chip>
					</div>

					<Row
						name="手机后台推送"
						hint={
							cap.block === "insecure"
								? "当前地址非 HTTPS，浏览器禁止后台通知。请通过局域网安全模式或隧道访问。"
								: "切出手机后台或锁屏时，通过 Web Push 接收提醒"
						}
						reason={cap.available || canToggle ? null : cap.reason}
					>
						<Switch
							label="手机后台推送"
							checked={subscribed}
							disabled={busy || !canToggle}
							onChange={(v) => void onTogglePush(v)}
						/>
					</Row>

					{cap.hint && (
						<p className="text-[11px] text-m-text-3 leading-relaxed">{cap.hint}</p>
					)}

					{subscribed && cap.available && (
						<div className="pt-2">
							<ActionButton onClick={() => void onTest()} disabled={busy}>
								发送测试推送通知
							</ActionButton>
						</div>
					)}
				</div>
			</div>
		</BottomSheet>
	);
}
