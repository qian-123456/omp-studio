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

import { tNow } from "../../stores/language";

export type ShortcutGroup = "navigation" | "session" | "panel" | "find" | "view";

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, string> = {
	get navigation() { return tNow("shortcutRegistry.group.navigation"); },
	get session() { return tNow("shortcutRegistry.group.session"); },
	get panel() { return tNow("shortcutRegistry.group.panel"); },
	get find() { return tNow("shortcutRegistry.group.find"); },
	get view() { return tNow("shortcutRegistry.group.view"); },
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
	{ id: "settings.toggle", get label() { return tNow("shortcutRegistry.settings.toggle.label"); }, get description() { return tNow("shortcutRegistry.settings.toggle.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+Comma", editable: true },
	{ id: "shortcuts.show", get label() { return tNow("shortcutRegistry.shortcuts.show.label"); }, get description() { return tNow("shortcutRegistry.shortcuts.show.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+Slash", editable: true },
	{ id: "search.sessions", get label() { return tNow("shortcutRegistry.search.sessions.label"); }, get description() { return tNow("shortcutRegistry.search.sessions.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+K", editable: true },
	{ id: "nav.back", get label() { return tNow("shortcutRegistry.nav.back.label"); }, get description() { return tNow("shortcutRegistry.nav.back.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+BracketLeft", editable: true },
	{ id: "nav.forward", get label() { return tNow("shortcutRegistry.nav.forward.label"); }, get description() { return tNow("shortcutRegistry.nav.forward.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+BracketRight", editable: true },
	{ id: "view.inbox", get label() { return tNow("shortcutRegistry.view.inbox.label"); }, get description() { return tNow("shortcutRegistry.view.inbox.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+1", editable: true },
	{ id: "view.schedules", get label() { return tNow("shortcutRegistry.view.schedules.label"); }, get description() { return tNow("shortcutRegistry.view.schedules.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+2", editable: true },
	{ id: "view.skills", get label() { return tNow("shortcutRegistry.view.skills.label"); }, get description() { return tNow("shortcutRegistry.view.skills.desc"); }, group: "navigation", defaultAccelerator: "CommandOrControl+3", editable: true },
	// 会话
	{ id: "session.new", get label() { return tNow("shortcutRegistry.session.new.label"); }, group: "session", defaultAccelerator: "CommandOrControl+N", editable: true },
	{ id: "session.prev", get label() { return tNow("shortcutRegistry.session.prev.label"); }, get description() { return tNow("shortcutRegistry.session.prev.desc"); }, group: "session", defaultAccelerator: "CommandOrControl+Shift+BracketLeft", editable: true },
	{ id: "session.next", get label() { return tNow("shortcutRegistry.session.next.label"); }, get description() { return tNow("shortcutRegistry.session.next.desc"); }, group: "session", defaultAccelerator: "CommandOrControl+Shift+BracketRight", editable: true },
	{ id: "session.reopen", get label() { return tNow("shortcutRegistry.session.reopen.label"); }, get description() { return tNow("shortcutRegistry.session.reopen.desc"); }, group: "session", defaultAccelerator: "CommandOrControl+Shift+T", editable: true },
	// 面板
	{ id: "panel.sidebar", get label() { return tNow("shortcutRegistry.panel.sidebar.label"); }, group: "panel", defaultAccelerator: "CommandOrControl+B", editable: true },
	{ id: "panel.right", get label() { return tNow("shortcutRegistry.panel.right.label"); }, group: "panel", defaultAccelerator: "CommandOrControl+J", editable: true },
	{ id: "panel.terminal", get label() { return tNow("shortcutRegistry.panel.terminal.label"); }, get description() { return tNow("shortcutRegistry.panel.terminal.desc"); }, group: "panel", defaultAccelerator: "CommandOrControl+Backquote", editable: true },
	// 查找
	{ id: "find.thread", get label() { return tNow("shortcutRegistry.find.thread.label"); }, get description() { return tNow("shortcutRegistry.find.thread.desc"); }, group: "find", defaultAccelerator: "CommandOrControl+F", editable: true },
	// 视图（固定）
	{ id: "tab.close", get label() { return tNow("shortcutRegistry.tab.close.label"); }, get description() { return tNow("shortcutRegistry.tab.close.desc"); }, group: "view", defaultAccelerator: "CommandOrControl+W", editable: false },
	{ id: "zoom.in", get label() { return tNow("shortcutRegistry.zoom.in.label"); }, group: "view", defaultAccelerator: "CommandOrControl+Equal", editable: false },
	{ id: "zoom.out", get label() { return tNow("shortcutRegistry.zoom.out.label"); }, group: "view", defaultAccelerator: "CommandOrControl+Minus", editable: false },
	{ id: "zoom.reset", get label() { return tNow("shortcutRegistry.zoom.reset.label"); }, group: "view", defaultAccelerator: "CommandOrControl+0", editable: false },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const BY_ID: ReadonlyMap<string, ShortcutDef> = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutDef(id: ShortcutId): ShortcutDef {
	return BY_ID.get(id) as ShortcutDef;
}
