import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
	id: number;
	text: string;
	kind: ToastKind;
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

export function toast(text: string, opts?: { kind?: ToastKind; ms?: number }): void {
	const kind = opts?.kind ?? "info";
	const ms = opts?.ms ?? (kind === "error" ? 4000 : 2400);
	const id = nextId++;
	items = [...items, { id, text, kind }].slice(-MAX_VISIBLE);
	emit();
	setTimeout(() => {
		if (!items.some((t) => t.id === id)) return;
		items = items.filter((t) => t.id !== id);
		emit();
	}, ms);
}

export function ToastHost() {
	const list = useSyncExternalStore(subscribe, getItems, getItems);
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-4"
			style={{ bottom: "calc(var(--m-safe-bottom) + 72px)" }}
		>
			{list.map((t) => (
				<div
					key={t.id}
					role="status"
					className="pointer-events-auto flex max-w-full items-center gap-2 rounded-m-pill bg-m-text px-4 py-2.5 text-m-sm text-m-bg shadow-m-pop transition duration-200 starting:translate-y-2 starting:opacity-0"
				>
					{t.kind === "success" && <CircleCheck size={16} className="shrink-0" />}
					{t.kind === "error" && <CircleAlert size={16} className="shrink-0" />}
					<span className="min-w-0 break-words">{t.text}</span>
				</div>
			))}
		</div>
	);
}
