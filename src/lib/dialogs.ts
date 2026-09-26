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

export function errMsg(err: unknown): string {
	if (typeof err === "string") return err;
	if (err instanceof Error) return err.message;
	return String(err);
}
