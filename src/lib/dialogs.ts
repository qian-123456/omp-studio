/**
 * Shared UI utilities usable by any feature (dialogs, clipboard, error text).
 * Moved out of features/git/ui.ts — features must not import across each other.
 */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";

/** Native yes/no dialog; falls back to window.confirm outside Tauri. */
export async function confirmDialog(
	message: string,
	opts: { title?: string; danger?: boolean; okLabel?: string } = {},
): Promise<boolean> {
	try {
		return await ask(message, {
			title: opts.title ?? "确认",
			kind: opts.danger ? "warning" : "info",
			okLabel: opts.okLabel ?? "确定",
			cancelLabel: "取消",
		});
	} catch {
		return window.confirm(message);
	}
}

export async function copyText(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		await writeText(text);
	}
}

/** Mirrors `rpc::SESSION_HELD_PREFIX` (src-tauri/src/rpc/mod.rs). */
export const SESSION_HELD_PREFIX = "SESSION_HELD:";

export function errMsg(err: unknown): string {
	const raw =
		typeof err === "string"
			? err
			: err instanceof Error
				? err.message
				: String(err);
	if (raw.startsWith(SESSION_HELD_PREFIX)) {
		const pid = raw.slice(SESSION_HELD_PREFIX.length);
		return `该会话正被另一个窗口/进程（PID ${pid}）占用，请在那个窗口操作或先关闭它`;
	}
	return raw;
}
