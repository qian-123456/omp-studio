/**
 * Global toast notifications. Single store; <Toaster/> renders at app root.
 * Usage: toast.error("发送失败: …") / toast.success("已记入收集箱") / toast.info(…)
 */
import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
	label: string;
	onClick: () => void;
}

export interface ToastItem {
	id: number;
	kind: ToastKind;
	text: string;
	action?: ToastAction;
}

interface ToastState {
	items: ToastItem[];
	push: (kind: ToastKind, text: string, ttlMs?: number, action?: ToastAction) => void;
	dismiss: (id: number) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set) => ({
	items: [],
	push: (kind, text, ttlMs = 3500, action) => {
		const id = ++seq;
		set((s) => ({ items: [...s.items.slice(-4), { id, kind, text, action }] }));
		if (ttlMs > 0) {
			setTimeout(() => {
				useToasts.getState().dismiss(id);
			}, ttlMs);
		}
	},
	dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export const toast = {
	info: (text: string, ttlMs?: number, action?: ToastAction) => useToasts.getState().push("info", text, ttlMs, action),
	success: (text: string, ttlMs?: number, action?: ToastAction) =>
		useToasts.getState().push("success", text, ttlMs, action),
	error: (text: string, ttlMs?: number) => useToasts.getState().push("error", text, ttlMs),
};
