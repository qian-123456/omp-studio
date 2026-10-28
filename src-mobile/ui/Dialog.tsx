import { useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlay, usePresence } from "./overlay";

export function Dialog({
	open,
	onClose,
	title,
	children,
	actions,
}: {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
}) {
	const { mounted, visible } = usePresence(open, 180);
	useOverlay(open, onClose);
	if (!mounted) return null;
	return createPortal(
		<div className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-6">
			<div
				aria-hidden
				onClick={onClose}
				className={`absolute inset-0 bg-m-scrim transition-opacity duration-180 ease-m ${visible ? "opacity-100" : "opacity-0"}`}
			/>
			<div
				role="dialog"
				aria-modal="true"
				className={`relative flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-m-xl bg-m-bg-elev text-m-text shadow-m-pop transition duration-180 ease-m ${visible ? "scale-100 opacity-100" : "scale-95 opacity-0"}`}
			>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-2">
					{title != null && <div className="mb-2 text-m-lg font-medium break-words">{title}</div>}
					<div className="m-selectable text-m-sm break-words text-m-text-2">{children}</div>
				</div>
				{actions != null && <div className="flex shrink-0 justify-end gap-2 px-5 pt-3 pb-5">{actions}</div>}
			</div>
		</div>,
		document.body,
	);
}

export interface ConfirmOptions {
	title?: string;
	message?: string;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
	id: number;
	resolve: (ok: boolean) => void;
}

let queue: readonly PendingConfirm[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
function getQueue(): readonly PendingConfirm[] {
	return queue;
}

/** Resolves true on confirm; false on cancel, scrim tap or back gesture. Concurrent calls queue. */
export function confirm(input: string | ConfirmOptions): Promise<boolean> {
	const opts: ConfirmOptions = typeof input === "string" ? { message: input } : input;
	return new Promise<boolean>((resolve) => {
		queue = [...queue, { ...opts, id: nextId++, resolve }];
		emit();
	});
}

function settle(id: number, ok: boolean): void {
	const head = queue[0];
	if (!head || head.id !== id) return;
	queue = queue.slice(1);
	emit();
	head.resolve(ok);
}

const BTN = "min-h-11 rounded-m-pill px-5 text-m-md font-medium whitespace-nowrap";

export function DialogHost() {
	const q = useSyncExternalStore(subscribe, getQueue, getQueue);
	const head = q[0];
	// Keep the last dialog's content mounted during its exit transition.
	const lastRef = useRef<PendingConfirm | undefined>(undefined);
	if (head) lastRef.current = head;
	const shown = head ?? lastRef.current;
	if (!shown) return null;
	return (
		<Dialog
			key={shown.id}
			open={head !== undefined}
			onClose={() => settle(shown.id, false)}
			title={shown.title}
			actions={
				<>
					<button type="button" className={`${BTN} text-m-accent active:bg-m-surface-hover`} onClick={() => settle(shown.id, false)}>
						{shown.cancelText ?? "取消"}
					</button>
					<button
						type="button"
						className={`${BTN} active:opacity-85 ${shown.danger ? "bg-m-danger-bg text-m-danger" : "bg-m-text text-m-bg"}`}
						onClick={() => settle(shown.id, true)}
					>
						{shown.confirmText ?? "确定"}
					</button>
				</>
			}
		>
			{shown.message}
		</Dialog>
	);
}
