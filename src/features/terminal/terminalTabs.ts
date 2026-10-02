/**
 * [E] Terminal instance tab actions used by RightPanelHeader, which renders
 * each visible terminal as its own Chrome-style tab while the "terminal"
 * panel tab is active. Operates on drawerStore/drawerRegistry only;
 * CommandTerminalPanel mounts xterm hosts for whatever tabs the store holds.
 */
import { confirmDialog } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { destroyDrawerTerminal, drawerRegistry } from "./drawerRegistry";
import { type DrawerTab, useDrawerStore } from "./drawerStore";

export const STATUS_DOT: Record<DrawerTab["status"], string> = {
	opening: "bg-sky-400 animate-pulse",
	ready: "bg-emerald-400",
	exited: "bg-neutral-600",
	error: "bg-red-500",
};

export const STATUS_LABEL: Record<DrawerTab["status"], string> = {
	opening: "正在连接",
	ready: "已连接",
	exited: "已退出",
	error: "启动失败",
};

/** Upper bound on visible terminals; each one is a live shell process. */
const MAX_VISIBLE_TERMINALS = 10;

/**
 * Add a tab synchronously so it renders and activates immediately, titled
 * "终端 N" (lowest unused N). Like a browser, "new" always creates a new tab;
 * past MAX_VISIBLE_TERMINALS it refuses and points the user at closing or
 * folding one, so idle shells can't pile up without bound.
 * The cwd is the selected session's when known; otherwise left empty and
 * resolved by the panel while spawning the PTY.
 */
export function addTerminalTab(): string | null {
	const visible = useDrawerStore.getState().tabs.filter((t) => !t.detached);
	if (visible.length >= MAX_VISIBLE_TERMINALS) {
		toast.info(`最多同时打开 ${MAX_VISIBLE_TERMINALS} 个终端，请先关闭或折叠一个`);
		return null;
	}
	const sessionId = useUi.getState().selectedSessionId;
	const cwd = (sessionId && useSessions.getState().sessions[sessionId]?.cwd) || "";
	const titles = new Set(useDrawerStore.getState().tabs.map((t) => t.title));
	let n = 1;
	while (titles.has(`终端 ${n}`)) n++;
	return useDrawerStore.getState().addTab(cwd, `终端 ${n}`);
}

/** Fold a terminal into a background service; closes the panel tab when none stay visible. */
export function detachTerminalTab(tabId: string): void {
	drawerRegistry.get(tabId)?.term.element?.remove();
	useDrawerStore.getState().detachTab(tabId);
	if (!useDrawerStore.getState().tabs.some((t) => !t.detached)) {
		useUi.getState().closeRightTab("terminal");
	}
	toast.success("已折叠为后台服务（可在右侧「服务」面板查看与恢复）");
}

/** Kill a terminal (confirming when it ran something); closes the panel tab with the last one. */
export async function closeTerminalTab(tabId: string): Promise<void> {
	const entry = drawerRegistry.get(tabId);
	if (entry && entry.phase === "ready" && entry.used) {
		const ok = await confirmDialog("终止此终端中正在运行的进程？", {
			danger: true,
			title: "关闭终端",
			okLabel: "终止并关闭",
		});
		if (!ok) return;
	}
	destroyDrawerTerminal(tabId);
	const remainingVisible = useDrawerStore
		.getState()
		.tabs.filter((t) => !t.detached && t.id !== tabId).length;
	useDrawerStore.getState().removeTab(tabId);
	if (remainingVisible === 0) useUi.getState().closeRightTab("terminal");
}
