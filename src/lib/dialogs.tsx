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
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Z_LAYER } from "../components/FloatingLayer";
import { isComposing, useEscapeKey } from "./hooks";
import { claimEscape } from "./escapeClaim";
import { clipboardWriteMessage } from "./ipc";
import { tNow } from "../stores/language";
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
						title={tNow("components.closeEsc")}
						aria-label={tNow("shell.closeDialog")}
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

/**
 * Mounts an imperative prompt dialog in its own React root and resolves with
 * the first value passed to `resolve`; the root and host element are removed
 * afterwards. Later `resolve` calls are ignored.
 */
export function mountPromptDialog<T>(render: (resolve: (value: T) => void) => ReactNode): Promise<T> {
	return new Promise<T>((resolve) => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		let settled = false;
		const done = (value: T) => {
			if (settled) return;
			settled = true;
			root.unmount();
			host.remove();
			resolve(value);
		};
		root.render(render(done));
	});
}

function showConfirmDialog(
	message: string,
	opts: { title: string; danger: boolean; okLabel: string; cancelLabel: string },
): Promise<boolean> {
	return mountPromptDialog<boolean>((done) => (
		<ConfirmDialogView
			title={opts.title}
			message={message}
			okLabel={opts.okLabel}
			cancelLabel={opts.cancelLabel}
			danger={opts.danger}
			onDone={done}
		/>
	));
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
				title: opts.title ?? tNow("shell.confirmTitle"),
				danger: opts.danger ?? false,
				okLabel: opts.okLabel ?? tNow("shell.confirmOk"),
				cancelLabel: opts.cancelLabel ?? tNow("common.cancel"),
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

let lastMessageCopy: { text: string; raw: string; paths: string[] } | null = null;

/**
 * The last in-app message copy when `pastedText` is exactly that message's
 * text, else null. WKWebView does not reliably surface the pasteboard's file
 * items to `paste` events next to a text item, so the composer rebuilds the
 * message (text + images in order) from this record instead.
 */
export function copiedMessageFor(pastedText: string): { raw: string; paths: string[] } | null {
	if (!lastMessageCopy || lastMessageCopy.paths.length === 0) return null;
	return pastedText.trim() === lastMessageCopy.text.trim() ? lastMessageCopy : null;
}

/**
 * Copy a message's text together with its image files. Images go through the
 * native pasteboard as file URLs (WKWebView's async clipboard API silently
 * fails for ClipboardItem writes), one item per image plus the text. `raw` is
 * the message with its inline image markers, used to restore image positions.
 */
export async function copyTextWithImages(
	text: string,
	imagePaths: string[],
	raw: string = text,
): Promise<void> {
	if (imagePaths.length === 0) {
		lastMessageCopy = null;
		await copyText(text);
		return;
	}
	await clipboardWriteMessage(text, imagePaths);
	lastMessageCopy = { text, raw, paths: imagePaths };
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
		return tNow("shell.sessionLockedByPid", { pid });
	}
	return raw;
}
