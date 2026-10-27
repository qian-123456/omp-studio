import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { copyText } from "../../core/lib/format";
import { MSG_SIZE_KEY, FOLD_OPEN_KEY, msgSizeFromPref, type ApprovalMode, APPROVAL_MODES, SCHEMES, SKINS, MSG_SIZES, approvalEffect } from "./settingsMap";
import { usePrefs } from "../../core/stores/prefs";
import { Chip, toast } from "../../ui";
import { ActionButton, Row, Section, Segmented, Switch } from "./controls";
import { disablePush, enablePush, currentSubscription, pushCapability, readPushEnv, sendTestPush, type PushCapability } from "./push";

/* ---------------------------------------------------------------- 外观 */

export function AppearanceSection() {
	const skin = usePrefs((s) => s.skin);
	const scheme = usePrefs((s) => s.scheme);
	const size = usePrefs((s) => msgSizeFromPref(s.extra[MSG_SIZE_KEY]));
	const foldOpen = usePrefs((s) => s.extra[FOLD_OPEN_KEY] === true);
	const set = usePrefs((s) => s.set);
	const setExtra = usePrefs((s) => s.setExtra);
	return (
		<Section title="外观" note="外观只影响这台手机，不会改动电脑上的设置。">
			<Row name="风格" hint={SKINS.find((s) => s.value === skin)?.hint} stacked>
				<Segmented label="风格" value={skin} options={SKINS} onChange={(v) => set({ skin: v })} />
			</Row>
			<div className="border-b border-m-border px-4 py-3" aria-label="当前风格预览">
				<div className="flex flex-col gap-2 rounded-m-lg bg-m-bg p-3">
					<div className="self-end rounded-m-lg bg-m-bubble-user-bg px-3 py-2 text-m-sm whitespace-nowrap text-m-bubble-user-text">帮我看看这个报错</div>
					<div className="text-m-sm text-m-text">好的，我先看一下日志。</div>
					<div className="flex gap-2">
						<Chip tone="accent">运行中</Chip>
						<Chip tone="success">已完成</Chip>
						<Chip tone="warn">待确认</Chip>
						<Chip tone="danger">失败</Chip>
					</div>
				</div>
			</div>
			<Row name="明暗" stacked>
				<Segmented label="明暗" value={scheme} options={SCHEMES} onChange={(v) => set({ scheme: v })} />
			</Row>
			<Row name="消息字号" hint="调整对话文字大小。" stacked>
				<Segmented label="消息字号" value={size} options={MSG_SIZES} onChange={(v) => setExtra(MSG_SIZE_KEY, v)} />
			</Row>
			<Row name="默认展开步骤" hint="对话里「已处理 N 个步骤」默认展开。">
				<Switch label="默认展开步骤" checked={foldOpen} onChange={(v) => setExtra(FOLD_OPEN_KEY, v)} />
			</Row>
		</Section>
	);
}

/* ---------------------------------------------------------------- 权限模式 */

export function PermissionSection({ mode, onChanged }: { mode: ApprovalMode | null; onChanged: (m: ApprovalMode) => void }) {
	const [busy, setBusy] = useState(false);
	const choose = async (next: ApprovalMode) => {
		if (busy) return;
		setBusy(true);
		try {
			const r = await api<{ defaultApprovalMode?: ApprovalMode }>("POST", "/left/settings/approval-mode", { mode: next });
			onChanged(r.defaultApprovalMode ?? next);
			toast("权限模式已更新，对之后新开的会话生效", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Section
			title="权限模式"
			note="已经在运行的会话保持原来的模式；新开的会话使用这里的选择。手机上只有这里能改权限模式。"
		>
			<Row name="智能体执行操作前" hint={mode ? approvalEffect(mode) : "正在读取当前模式。"} stacked>
				<Segmented
					label="权限模式"
					value={mode}
					disabled={busy || mode == null}
					options={APPROVAL_MODES.map((m) => ({ value: m.value, label: m.label }))}
					onChange={(v) => void choose(v)}
				/>
			</Row>
		</Section>
	);
}

/* ---------------------------------------------------------------- 通知 */

export function NotifySection() {
	const sound = usePrefs((s) => s.notifySound);
	const flash = usePrefs((s) => s.titleFlash);
	const set = usePrefs((s) => s.set);
	const [cap, setCap] = useState<PushCapability>(() => pushCapability(readPushEnv()));
	const [on, setOn] = useState(false);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		const env = readPushEnv();
		setCap(pushCapability(env));
		setOn(await currentSubscription(env));
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const toggle = async (next: boolean) => {
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
	const canToggle = cap.available || (on && cap.block === "denied");
	return (
		<Section title="通知" note="推送通知在页面关闭或手机锁屏时也能提醒你；下面两项只在页面打开时提醒，任何连接方式都可用。">
			<Row
				name="推送通知"
				hint="会话需要你处理、等待审批或完成一轮时通知你。"
				reason={cap.available || canToggle ? null : cap.reason}
			>
				<Switch label="推送通知" checked={on} disabled={busy || !canToggle} onChange={(v) => void toggle(v)} />
			</Row>
			{cap.hint != null && <p className="border-b border-m-border px-4 py-3 text-m-xs leading-relaxed text-m-text-3">{cap.hint}</p>}
			{on && cap.available && (
				<Row name="测试推送" hint="立刻发一条测试通知，确认这台手机能收到。">
					<ActionButton onClick={() => void test()} disabled={busy}>
						发送测试通知
					</ActionButton>
				</Row>
			)}
			<Row name="提示音" hint="页面打开时，会话需要你处理就响一声。">
				<Switch label="提示音" checked={sound} onChange={(v) => set({ notifySound: v })} />
			</Row>
			<Row name="标题闪烁" hint="页面在后台时，让浏览器标签标题闪烁提醒。">
				<Switch label="标题闪烁" checked={flash} onChange={(v) => set({ titleFlash: v })} />
			</Row>
		</Section>
	);
}

/* ---------------------------------------------------------------- 连接信息 */

export interface MobileInfo {
	running?: boolean;
	port?: number | null;
	lanUrl?: string | null;
	tunnelUrl?: string | null;
	ipv6Running?: boolean;
	ipv6Url?: string | null;
}

function UrlRow({ name, url }: { name: string; url: string }) {
	return (
		<div className="border-b border-m-border px-4 py-3 last:border-b-0">
			<div className="text-m-xs whitespace-nowrap text-m-text-3">{name}</div>
			<div className="mt-1 flex items-start gap-2">
				<code className="min-w-0 flex-1 font-m-mono text-m-sm break-all text-m-text select-all">{url}</code>
				<button
					type="button"
					aria-label={`复制${name}`}
					onClick={async () => toast((await copyText(url)) ? "已复制" : "复制失败，请长按地址手动复制", { kind: "info" })}
					className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-md bg-m-surface text-m-text active:bg-m-surface-hover"
				>
					<Copy size={18} />
				</button>
			</div>
		</div>
	);
}

export function ConnectionSection({
	mobile,
	appVersion,
	defaultModel,
	defaultModelSource,
}: {
	mobile: MobileInfo;
	appVersion?: string | null;
	defaultModel?: string | null;
	defaultModelSource?: string | null;
}) {
	const here = typeof location === "undefined" ? "" : location.origin;
	return (
		<Section
			title="连接信息"
			note="开关手机服务与 IPv6 需在电脑上操作：在手机上关闭会立刻断开当前连接，且无法再从手机重新打开。"
		>
			<Row name="服务状态">
				<Chip tone={mobile.running ? "success" : "warn"}>{mobile.running ? "运行中" : "未运行"}</Chip>
			</Row>
			{mobile.port != null && <Row name="端口">
				<span className="text-m-sm text-m-text-2">{mobile.port}</span>
			</Row>}
			{here && <UrlRow name="当前访问地址" url={here} />}
			{mobile.lanUrl && <UrlRow name="局域网地址" url={mobile.lanUrl} />}
			{mobile.tunnelUrl && <UrlRow name="隧道地址" url={mobile.tunnelUrl} />}
			{mobile.ipv6Running && mobile.ipv6Url && <UrlRow name="IPv6 地址" url={mobile.ipv6Url} />}
			{appVersion != null && appVersion !== "" && (
				<Row name="应用版本">
					<span className="text-m-sm text-m-text-2">{appVersion}</span>
				</Row>
			)}
			{defaultModel && (
				<Row name="默认模型" hint={defaultModelSource ? `来源：${defaultModelSource}` : undefined}>
					<span className="text-m-sm break-all text-m-text-2">{defaultModel}</span>
				</Row>
			)}
		</Section>
	);
}
