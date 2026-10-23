/**
 * Single source of truth for the app's in-window keyboard shortcuts.
 *
 * Accelerator strings use the Tauri global-shortcut grammar already produced by
 * ShortcutRecorder (`CommandOrControl+Shift+BracketLeft`): modifiers joined with
 * `+`, then a `KeyboardEvent.code`-style key token (KeyK, Digit1, Comma, Backquote…).
 * On macOS `CommandOrControl` is ⌘ and `Control` is ⌃.
 *
 * `editable: false` entries are listed in Settings ▸ 快捷键 for reference only:
 * they are owned by the native menu (⌘W) or by a non-rebindable handler.
 */

export type ShortcutGroup = "navigation" | "session" | "panel" | "find" | "view";

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, string> = {
	navigation: "导航",
	session: "会话",
	panel: "面板",
	find: "查找",
	view: "视图",
};

export interface ShortcutDef {
	id: string;
	/** Plain-language action name shown in Settings. */
	label: string;
	/** One line of what it does / when it does nothing. */
	description?: string;
	group: ShortcutGroup;
	/** "" = unbound by default. */
	defaultAccelerator: string;
	editable: boolean;
}

export const SHORTCUTS = [
	// 导航
	{ id: "settings.toggle", label: "打开 / 关闭设置", description: "设置已打开时再按一次关闭", group: "navigation", defaultAccelerator: "CommandOrControl+Comma", editable: true },
	{ id: "shortcuts.show", label: "查看快捷键", description: "打开设置里的快捷键页", group: "navigation", defaultAccelerator: "CommandOrControl+Slash", editable: true },
	{ id: "search.sessions", label: "搜索会话", description: "跨会话搜索标题和消息内容", group: "navigation", defaultAccelerator: "CommandOrControl+K", editable: true },
	{ id: "nav.back", label: "后退", description: "离开全屏页面；在侧聊里回到父会话", group: "navigation", defaultAccelerator: "CommandOrControl+BracketLeft", editable: true },
	{ id: "nav.forward", label: "前进", description: "回到刚用「后退」离开的位置", group: "navigation", defaultAccelerator: "CommandOrControl+BracketRight", editable: true },
	{ id: "view.inbox", label: "收件箱", description: "再按一次回到会话", group: "navigation", defaultAccelerator: "CommandOrControl+1", editable: true },
	{ id: "view.schedules", label: "定时任务", description: "再按一次回到会话", group: "navigation", defaultAccelerator: "CommandOrControl+2", editable: true },
	{ id: "view.skills", label: "技能管理", description: "再按一次回到会话", group: "navigation", defaultAccelerator: "CommandOrControl+3", editable: true },
	// 会话
	{ id: "session.new", label: "新建会话", group: "session", defaultAccelerator: "CommandOrControl+N", editable: true },
	{ id: "session.prev", label: "上一个会话", description: "按侧栏当前显示的顺序，到头不循环", group: "session", defaultAccelerator: "CommandOrControl+Shift+BracketLeft", editable: true },
	{ id: "session.next", label: "下一个会话", description: "按侧栏当前显示的顺序，到头不循环", group: "session", defaultAccelerator: "CommandOrControl+Shift+BracketRight", editable: true },
	{ id: "session.reopen", label: "恢复刚归档的会话", description: "把最近归档的会话找回来并打开", group: "session", defaultAccelerator: "CommandOrControl+Shift+T", editable: true },
	// 面板
	{ id: "panel.sidebar", label: "显示 / 隐藏侧栏", group: "panel", defaultAccelerator: "CommandOrControl+B", editable: true },
	{ id: "panel.right", label: "显示 / 隐藏右侧面板", group: "panel", defaultAccelerator: "CommandOrControl+J", editable: true },
	{ id: "panel.terminal", label: "右侧命令终端", description: "已在终端页时收起右侧面板", group: "panel", defaultAccelerator: "CommandOrControl+Backquote", editable: true },
	// 查找
	{ id: "find.thread", label: "在当前对话中查找", description: "没有打开对话时改为搜索会话", group: "find", defaultAccelerator: "CommandOrControl+F", editable: true },
	// 视图（固定）
	{ id: "tab.close", label: "关闭标签页", description: "依次关闭弹层、右侧标签，最后隐藏窗口", group: "view", defaultAccelerator: "CommandOrControl+W", editable: false },
	{ id: "zoom.in", label: "放大界面", group: "view", defaultAccelerator: "CommandOrControl+Equal", editable: false },
	{ id: "zoom.out", label: "缩小界面", group: "view", defaultAccelerator: "CommandOrControl+Minus", editable: false },
	{ id: "zoom.reset", label: "界面恢复 100%", group: "view", defaultAccelerator: "CommandOrControl+0", editable: false },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID: ReadonlyMap<string, ShortcutDef> = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutDef(id: ShortcutId): ShortcutDef {
	return BY_ID.get(id) as ShortcutDef;
}
