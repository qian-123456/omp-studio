/** Small UI utilities for module C features (dialogs, clipboard, home dir). */

import { homeDir } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { shortPath } from "./helpers";

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

let homeCache: string | null = null;
let homePromise: Promise<string | null> | null = null;

/** User home directory (cached), for `~` path shortening. */
export function useHomeDir(): string | null {
	const [home, setHome] = useState<string | null>(homeCache);
	useEffect(() => {
		if (homeCache) return;
		homePromise ??= homeDir()
			.then((h) => {
				homeCache = h;
				return h;
			})
			.catch(() => null);
		homePromise.then((h) => setHome(h));
	}, []);
	return home;
}

/** `(path) => path with ~ for home`. */
export function useShortPath(): (path: string) => string {
	const home = useHomeDir();
	return useCallback((path: string) => shortPath(path, home), [home]);
}
