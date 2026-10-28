import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "../../../core/lib/format";
import { Chip, IconButton, ListGroup, ListRow, toast } from "../../../ui";
import { SettingsSheet } from "../rows";

/** `GET /left/settings` → `mobile`: state of the phone service on the desktop. */
export interface MobileInfo {
	running?: boolean;
	port?: number | null;
	lanUrl?: string | null;
	tunnelUrl?: string | null;
	ipv6Running?: boolean;
	ipv6Url?: string | null;
}

function UrlRow({ label, url }: { label: string; url: string }) {
	const [copied, setCopied] = useState(false);
	const onCopy = async () => {
		if (await copyText(url)) {
			setCopied(true);
			toast("已复制", { kind: "success" });
			setTimeout(() => setCopied(false), 2000);
		} else {
			toast("复制失败，请长按地址手动复制", { kind: "error" });
		}
	};
	return (
		<ListRow
			title={label}
			subtitle={<span className="m-selectable font-m-mono break-all text-m-text-2">{url}</span>}
			right={
				<IconButton
					variant="plain"
					icon={copied ? <Check size={20} className="text-m-success" /> : <Copy size={20} strokeWidth={1.75} />}
					label={`复制${label}`}
					onClick={() => void onCopy()}
				/>
			}
		/>
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
	const here = typeof location === "undefined" ? "" : location.origin;
	return (
		<SettingsSheet open={open} onClose={onClose} title="连接与设备">
			<ListGroup title="手机服务">
				<ListRow title="服务状态" right={<Chip tone={mobile.running ? "success" : "warn"}>{mobile.running ? "运行中" : "未运行"}</Chip>} />
				{mobile.port != null && <ListRow title="端口" right={<span className="font-m-mono">{mobile.port}</span>} />}
				{appVersion && <ListRow title="电脑端版本" right={<span className="font-m-mono">{appVersion}</span>} />}
			</ListGroup>
			<ListGroup title="访问地址" note="把地址发到其他设备上的浏览器即可访问；首次打开需要在电脑上确认配对。">
				{here && <UrlRow label="当前地址" url={here} />}
				{mobile.lanUrl && <UrlRow label="局域网地址" url={mobile.lanUrl} />}
				{mobile.tunnelUrl && <UrlRow label="隧道地址" url={mobile.tunnelUrl} />}
				{mobile.ipv6Running && mobile.ipv6Url && <UrlRow label="IPv6 地址" url={mobile.ipv6Url} />}
			</ListGroup>
			<p className="px-8 pt-2 text-m-xs break-words text-m-text-3">
				开关手机服务、切换端口和 IPv6 需要在电脑上操作：在手机上关闭会立刻断开当前连接，且无法再从手机重新打开。
			</p>
		</SettingsSheet>
	);
}
