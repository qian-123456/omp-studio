import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Chip, toast } from "../../../ui";
import { copyText } from "../../../core/lib/format";
import type { MobileInfo } from "../sections";

function CopyRow({ label, value }: { label: string; value: string }) {
	const [copied, setCopied] = useState(false);

	const onCopy = async () => {
		try {
			await copyText(value);
			setCopied(true);
			toast("已复制到剪贴板", { kind: "success" });
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast("复制失败", { kind: "error" });
		}
	};

	return (
		<div className="flex items-center justify-between py-2 border-b border-m-border last:border-b-0">
			<div className="min-w-0 pr-2">
				<div className="text-[11px] text-m-text-3">{label}</div>
				<div className="truncate font-m-mono text-m-xs text-m-text select-all">{value}</div>
			</div>
			<button
				type="button"
				aria-label={`复制 ${label}`}
				onClick={onCopy}
				className="flex h-9 w-9 shrink-0 items-center justify-center rounded-m-md bg-m-surface text-m-text active:bg-m-surface-hover"
			>
				{copied ? <Check size={16} className="text-m-success" /> : <Copy size={16} />}
			</button>
		</div>
	);
}

export function ConnectionSheet({
	open,
	onClose,
	mobile = {},
	appVersion,
}: {
	open: boolean;
	onClose: () => void;
	mobile?: MobileInfo;
	appVersion?: string | null;
}) {
	const origin = typeof location !== "undefined" ? location.origin : "http://localhost:1425";

	return (
		<BottomSheet open={open} onClose={onClose} title="连接与设备">
			<div className="space-y-4 px-4 pb-8">
				{/* Status */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center justify-between">
						<span className="text-m-xs font-semibold text-m-text">服务运行状态</span>
						<Chip tone={mobile.running ? "success" : "warn"}>
							{mobile.running ? "运行中" : "未运行"}
						</Chip>
					</div>

					<div className="flex items-center justify-between text-m-xs text-m-text-3">
						<span>服务端口</span>
						<span className="font-m-mono text-m-text">{mobile.port || 1425}</span>
					</div>

					{appVersion && (
						<div className="flex items-center justify-between text-m-xs text-m-text-3">
							<span>电脑应用版本</span>
							<span className="font-m-mono text-m-text">{appVersion}</span>
						</div>
					)}
				</div>

				{/* Access URLs */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="text-m-xs font-semibold text-m-text">访问地址列表</div>

					<div className="divide-y divide-m-border/60">
						<CopyRow label="当前访问地址" value={origin} />
						{mobile.lanUrl && <CopyRow label="局域网地址 (LAN)" value={mobile.lanUrl} />}
						{mobile.tunnelUrl && <CopyRow label="安全隧道地址 (Tunnel)" value={mobile.tunnelUrl} />}
						{mobile.ipv6Running && mobile.ipv6Url && (
							<CopyRow label="IPv6 地址" value={mobile.ipv6Url} />
						)}
					</div>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="text-m-xs font-semibold text-m-text">配对安全提醒</div>
					<p className="text-[11px] leading-relaxed text-m-text-3">
						开关手机服务与切换端口需在电脑客户端操作。如需重置配对或注销已连接设备，请在电脑上重新生成配对二维码。
					</p>
				</div>
			</div>
		</BottomSheet>
	);
}
