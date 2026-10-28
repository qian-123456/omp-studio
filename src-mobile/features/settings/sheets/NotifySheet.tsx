import { BellRing, Send, Volume2, PanelTop } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../../core/api";
import { usePrefs } from "../../../core/stores/prefs";
import { Button, ListGroup, Switch, toast } from "../../../ui";
import { currentSubscription, disablePush, enablePush, pushCapability, readPushEnv, sendTestPush, type PushCapability } from "../push";
import { GroupBlock, SettingRow, SettingsSheet } from "../rows";

const ICON = { size: 22, strokeWidth: 1.75 } as const;

export function NotifySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const sound = usePrefs((s) => s.notifySound);
	const flash = usePrefs((s) => s.titleFlash);
	const set = usePrefs((s) => s.set);
	const [cap, setCap] = useState<PushCapability>(() => pushCapability(readPushEnv()));
	const [subscribed, setSubscribed] = useState(false);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		const env = readPushEnv();
		setCap(pushCapability(env));
		setSubscribed(await currentSubscription(env));
	}, []);

	useEffect(() => {
		if (open) void refresh();
	}, [open, refresh]);

	const togglePush = async (next: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			if (next) await enablePush();
			else await disablePush();
			toast(next ? "已开启推送通知" : "已关闭推送通知", { kind: "success" });
		} catch (e) {
			toast(`${next ? "开启" : "关闭"}失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			await refresh();
			setBusy(false);
		}
	};

	const test = async () => {
		setBusy(true);
		try {
			await sendTestPush();
			toast("已发送测试通知，请留意通知栏", { kind: "success" });
		} catch (e) {
			toast(`发送失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	// A previous grant that was later revoked still leaves a subscription to clean up.
	const canToggle = cap.available || (subscribed && cap.block === "denied");

	return (
		<SettingsSheet open={open} onClose={onClose} title="通知设置">
			<ListGroup
				title="推送通知"
				note="页面关闭或手机锁屏时也能收到：回答完成、等待你审批或回答问题、会话异常退出时都会提醒。"
			>
				<SettingRow
					icon={<BellRing {...ICON} />}
					name="推送通知"
					hint={cap.hint ?? undefined}
					reason={cap.available || canToggle ? undefined : cap.reason}
				>
					<Switch label="推送通知" checked={subscribed} disabled={busy || !canToggle} onChange={(v) => void togglePush(v)} />
				</SettingRow>
				{subscribed && cap.available && (
					<GroupBlock>
						<Button variant="tonal" size="sm" icon={<Send size={16} />} disabled={busy} onClick={() => void test()}>
							发送测试通知
						</Button>
					</GroupBlock>
				)}
			</ListGroup>
			<ListGroup title="页面打开时" note="这两项只在页面打开时生效，任何连接方式都可以用。">
				<SettingRow icon={<Volume2 {...ICON} />} name="提示音" hint="会话需要你处理时响一声">
					<Switch label="提示音" checked={sound} onChange={(v) => set({ notifySound: v })} />
				</SettingRow>
				<SettingRow icon={<PanelTop {...ICON} />} name="标题闪烁" hint="页面在后台时，让浏览器标签的标题闪烁">
					<Switch label="标题闪烁" checked={flash} onChange={(v) => set({ titleFlash: v })} />
				</SettingRow>
			</ListGroup>
		</SettingsSheet>
	);
}
