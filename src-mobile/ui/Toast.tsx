import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { errorMessage } from "../core/api";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
	id: number;
	text: string;
	kind: ToastKind;
	action?: { label: string; onClick: () => void | Promise<void> };
	busy?: boolean;
}

const MAX_VISIBLE = 3;
let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
function getItems(): readonly ToastItem[] {
	return items;
}

export function toast(text: string, opts?: { kind?: ToastKind; ms?: number; action?: { label: string; onClick: () => void | Promise<void> } }): void {
	const kind = opts?.kind ?? "info";
	const ms = opts?.ms ?? (opts?.action ? 5000 : kind === "error" ? 4000 : 2400);
	const id = nextId++;
	items = [...items, { id, text, kind, action: opts?.action }].slice(-MAX_VISIBLE);
	emit();
	setTimeout(() => {
		if (!items.some((t) => t.id === id) || items.some((t) => t.id === id && t.busy)) return;
		items = items.filter((t) => t.id !== id);
		emit();
	}, ms);
}

async function runAction(id: number): Promise<void> {
	const item = items.find((t) => t.id === id);
	if (!item?.action || item.busy) return;
	const action = item.action;
	items = items.map((t) => (t.id === id ? { ...t, action: undefined, busy: true } : t));
	emit();
	try {
		await action.onClick();
		items = items.filter((t) => t.id !== id);
		emit();
	} catch (e) {
		items = items.filter((t) => t.id !== id);
		toast(errorMessage(e), { kind: "error", ms: 8000 });
	}
}

export function ToastHost() {
	const list = useSyncExternalStore(subscribe, getItems, getItems);
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-4"
			style={{ bottom: "calc(var(--m-safe-bottom) + var(--m-kb, 0px) + 88px)" }}
		>
			{list.map((t) => (
				<div
					key={t.id}
					role="status"
					className={`m-selectable pointer-events-auto flex max-w-full items-center gap-2 rounded-m-md px-4 py-3 text-m-sm shadow-m-pop transition duration-200 starting:translate-y-2 starting:opacity-0 ${
						t.kind === "error" ? "bg-m-danger-bg text-m-danger" : "bg-m-text text-m-bg"
					}`}
				>
					{t.kind === "success" && <CircleCheck size={16} className="shrink-0" />}
					{t.kind === "error" && <CircleAlert size={16} className="shrink-0" />}
						<span className="min-w-0 whitespace-pre-wrap break-words">{t.text}</span>
						{(t.action || t.busy) && (
							<button
								type="button"
								disabled={t.busy}
								onClick={() => void runAction(t.id)}
								className="min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-m-pill px-3 font-semibold disabled:opacity-50"
							>
								{t.busy ? "处理中" : t.action?.label}
							</button>
						)}
				</div>
			))}
		</div>
	);
}
