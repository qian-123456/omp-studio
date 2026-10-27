import { CalendarClock, ChevronRight, Inbox, Lightbulb, Search, Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { nav, paths } from "../../core/nav";
import { BottomSheet } from "../../ui";

interface MenuEntry {
	key: string;
	label: string;
	hint: string;
	icon: ReactNode;
	path: () => string;
}

/** The old left drawer destinations, as a top-level menu. Pages are owned by other slices. */
export const MENU_ENTRIES: readonly MenuEntry[] = [
	{ key: "inbox", label: "收件箱", hint: "待回复、异常和未读会话", icon: <Inbox size={22} />, path: paths.inbox },
	{ key: "search", label: "搜索", hint: "按标题、分支查找会话", icon: <Search size={22} />, path: paths.search },
	{ key: "schedules", label: "定时任务", hint: "按计划自动运行的任务", icon: <CalendarClock size={22} />, path: paths.schedules },
	{ key: "skills", label: "Skills", hint: "技能与扩展开关", icon: <Sparkles size={22} />, path: paths.skills },
	{ key: "ideas", label: "想法", hint: "随手记下的想法", icon: <Lightbulb size={22} />, path: paths.ideas },
	{ key: "settings", label: "设置", hint: "模型、外观、通知", icon: <Settings size={22} />, path: paths.settings },
];

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<BottomSheet open={open} onClose={onClose} title="菜单">
			<div className="flex flex-col pb-2">
				{MENU_ENTRIES.map((e) => (
					<button
						key={e.key}
						type="button"
						onClick={() => {
							onClose();
							nav.push(e.path());
						}}
						className="flex min-h-14 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left active:bg-m-surface-hover"
					>
						<span className="flex shrink-0 text-m-text-2">{e.icon}</span>
						<span className="min-w-0 flex-1">
							<span className="block text-m-md text-m-text">{e.label}</span>
							<span className="block text-m-xs text-m-text-3">{e.hint}</span>
						</span>
						<ChevronRight size={18} className="shrink-0 text-m-text-3" />
					</button>
				))}
			</div>
		</BottomSheet>
	);
}
