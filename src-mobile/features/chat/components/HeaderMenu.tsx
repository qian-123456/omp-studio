import { Folder, GitBranch, MessagesSquare, Server, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { nav, paths } from "../../../core/nav";
import { BottomSheet, MenuRow } from "../../../ui";

interface Entry {
	label: string;
	hint: string;
	icon: ReactNode;
	to: (id: string) => string;
}

const icon = (I: typeof Folder) => <I size={22} strokeWidth={1.75} />;

/** The five tool pages reachable from a chat (docs/MOBILE_DESIGN.md §4.6). */
const ENTRIES: Entry[] = [
	{ label: "文件", hint: "浏览和查看项目文件", icon: icon(Folder), to: paths.files },
	{ label: "Git", hint: "改动、暂存与提交", icon: icon(GitBranch), to: paths.git },
	{ label: "终端", hint: "在项目目录里运行命令", icon: icon(Terminal), to: paths.terminal },
	{ label: "辅助对话", hint: "旁边问一句，不打断主对话", icon: icon(MessagesSquare), to: paths.sidechat },
	{ label: "服务", hint: "正在运行的本地服务和端口", icon: icon(Server), to: paths.services },
];

export function HeaderMenu({ open, onClose, sessionId }: { open: boolean; onClose: () => void; sessionId: string }) {
	return (
		<BottomSheet open={open} onClose={onClose} title="工具">
			<div className="pb-3">
				{ENTRIES.map((e) => (
					<MenuRow
						key={e.label}
						icon={e.icon}
						label={e.label}
						hint={e.hint}
						onClick={() => {
							onClose();
							nav.push(e.to(sessionId));
						}}
					/>
				))}
			</div>
		</BottomSheet>
	);
}
