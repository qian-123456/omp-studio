import { Folder, GitBranch, MessagesSquare, Server, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { nav, paths } from "../../../core/nav";
import { BottomSheet } from "../../../ui";

interface Entry {
	label: string;
	hint: string;
	icon: ReactNode;
	to: (id: string) => string;
}

/** Tool pages reachable from a chat. No heatmap on mobile. */
const ENTRIES: Entry[] = [
	{ label: "文件", hint: "浏览与查看项目文件", icon: <Folder size={20} />, to: paths.files },
	{ label: "Git", hint: "状态、提交与差异", icon: <GitBranch size={20} />, to: paths.git },
	{ label: "终端", hint: "在项目目录运行命令", icon: <Terminal size={20} />, to: paths.terminal },
	{ label: "辅助对话", hint: "不打断主会话的提问", icon: <MessagesSquare size={20} />, to: paths.sidechat },
	{ label: "服务", hint: "后台服务与任务", icon: <Server size={20} />, to: paths.services },
];

export function HeaderMenu({ open, onClose, sessionId }: { open: boolean; onClose: () => void; sessionId: string }) {
	return (
		<BottomSheet open={open} onClose={onClose} title="工具">
			<div className="pb-2">
				{ENTRIES.map((e) => (
					<button
						key={e.label}
						type="button"
						onClick={() => {
							onClose();
							nav.push(e.to(sessionId));
						}}
						className="flex min-h-14 w-full items-center gap-3 px-5 text-left active:bg-m-surface-hover"
					>
						<span className="text-m-text-2">{e.icon}</span>
						<span className="min-w-0 flex-1">
							<span className="block text-m-md">{e.label}</span>
							<span className="block text-m-xs text-m-text-3">{e.hint}</span>
						</span>
					</button>
				))}
			</div>
		</BottomSheet>
	);
}
