import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import clsx from "clsx";
import { useToasts, type ToastKind } from "../lib/toast";

const ICONS: Record<ToastKind, typeof Info> = {
	info: Info,
	success: CheckCircle2,
	error: AlertCircle,
};

const TINT: Record<ToastKind, string> = {
	info: "border-neutral-700 text-neutral-200",
	success: "border-emerald-800 text-emerald-200",
	error: "border-rose-800 text-rose-200",
};

/** Fixed bottom-right stack; mount once in App. */
export function Toaster() {
	const items = useToasts((s) => s.items);
	const dismiss = useToasts((s) => s.dismiss);
	if (items.length === 0) return null;
	return (
		<div
			className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-80 flex-col gap-2 select-text"
			role="status"
			aria-live="polite"
		>
			{items.map((t) => {
				const Icon = ICONS[t.kind];
				return (
					<div
						key={t.id}
						className={clsx(
							"pointer-events-auto flex items-start gap-2 rounded-lg border bg-neutral-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur",
							TINT[t.kind],
						)}
					>
						<Icon size={14} className="mt-0.5 shrink-0" />
						<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t.text}</span>
						<button
							type="button"
							title="关闭"
							aria-label="关闭通知"
							onClick={() => dismiss(t.id)}
							className="shrink-0 rounded p-0.5 text-neutral-500 hover:text-neutral-200"
						>
							<X size={12} />
						</button>
					</div>
				);
			})}
		</div>
	);
}
