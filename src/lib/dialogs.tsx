/**
 * Shared UI utilities usable by any feature (dialogs, clipboard, error text).
 * Moved out of features/git/ui.ts — features must not import across each other.
 *
 * confirmDialog is an in-app modal (the native ask() dialog can't scroll, so a
 * long message would push the buttons off screen). It blocks like the native
 * one: pending calls are serialized FIFO so at most one prompt is visible.
 */
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Z_LAYER } from "../components/FloatingLayer";
import { isComposing, useEscapeKey } from "./hooks";
import { claimEscape } from "./escapeClaim";

const CANCEL_BTN_CLASS =
	"press-scale rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors";
const OK_BTN_CLASS =
	"press-scale rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors";
const OK_TONE = { normal: "bg-[#0A84FF] hover:bg-[#0A84FF]/90", danger: "bg-[#FF453A] hover:bg-[#FF453A]/90" };

function ConfirmDialogView({
	title,
	message,
	okLabel,
	cancelLabel,
	danger,
	onDone,
}: {
	title: string;
	message: string;
	okLabel: string;
	cancelLabel: string;
	danger: boolean;
	onDone: (ok: boolean) => void;
}) {
	const titleId = useId();
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const okRef = useRef<HTMLButtonElement | null>(null);
	const cancel = useCallback(() => onDone(false), [onDone]);
	useEscapeKey(cancel);

	useEffect(() => {
		(danger ? cancelRef : okRef).current?.focus();
	}, [danger]);

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) cancel();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				className="w-[480px] max-w-[calc(100vw-2rem)] max-h-[min(85vh,560px)] flex flex-col rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-300 shadow-apple-modal hairline"
				onKeyDown={(e) => {
					e.stopPropagation();
					if (isComposing(e)) return;
					if (e.key === "Escape") {
						// stopPropagation above would keep Esc from reaching the
						// window listener, so cancel here directly.
						claimEscape(e);
						cancel();
						return;
					}
					if (e.key === "Enter") {
						const target = e.target as HTMLElement | null;
						if (target?.tagName === "BUTTON") return;
						e.preventDefault();
						onDone(true);
						return;
					}
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])"),
						).filter((el) => el.getClientRects().length > 0);
						if (controls.length === 0) return;
						const first = controls[0];
						const last = controls[controls.length - 1];
						if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="mb-3 flex items-center shrink-0">
					<span id={titleId} className="flex-1 text-[15px] font-semibold tracking-tight text-[var(--text)]">
						{title}
					</span>
					<button
						type="button"
						title="关闭 (Esc)"
						aria-label="关闭对话框"
						onClick={cancel}
						className="press-scale rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors"
					>
						<X size={15} />
					</button>
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto pr-1 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-neutral-300">
					{message}
				</div>
				<div className="flex items-center justify-end gap-2 shrink-0 pt-3 mt-2 border-t border-[var(--border-divider)]">
					<button ref={cancelRef} type="button" onClick={cancel} className={CANCEL_BTN_CLASS}>
						{cancelLabel}
					</button>
					<button
						ref={okRef}
						type="button"
						onClick={() => onDone(true)}
						className={`${OK_BTN_CLASS} ${danger ? OK_TONE.danger : OK_TONE.normal}`}
					>
						{okLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

function showConfirmDialog(
	message: string,
	opts: { title: string; danger: boolean; okLabel: string; cancelLabel: string },
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			root.unmount();
			host.remove();
			resolve(ok);
		};
		root.render(
			<ConfirmDialogView
				title={opts.title}
				message={message}
				okLabel={opts.okLabel}
				cancelLabel={opts.cancelLabel}
				danger={opts.danger}
				onDone={done}
			/>,
		);
	});
}

let dialogQueue: Promise<unknown> = Promise.resolve();

/** In-app yes/no dialog; falls back to window.confirm when there's no DOM. */
export function confirmDialog(
	message: string,
	opts: { title?: string; danger?: boolean; okLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
	try {
		const result = dialogQueue.then(() =>
			showConfirmDialog(message, {
				title: opts.title ?? "确认",
				danger: opts.danger ?? false,
				okLabel: opts.okLabel ?? "确定",
				cancelLabel: opts.cancelLabel ?? "取消",
			}),
		);
		dialogQueue = result.catch(() => {});
		return result;
	} catch {
		return Promise.resolve(window.confirm(message));
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
