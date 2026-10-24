import { AlertTriangle } from "lucide-react";
import { useT } from "../stores/language";

/** Inline failed-to-load state with a retry action. */
export function LoadFailed({
	what,
	error,
	onRetry,
}: {
	/** What failed, e.g. "会话列表". */
	what: string;
	error: string | null;
	onRetry: () => void;
}) {
	const { t } = useT();
	return (
		<div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
			<AlertTriangle size={16} className="text-red-400" />
			<div className="text-[12px] text-neutral-300">{t("components.loadFailedWhat", { what })}</div>
			{error && (
				<div className="max-w-full break-words text-[11px] text-neutral-500 select-text">{error}</div>
			)}
			<button
				type="button"
				onClick={onRetry}
				className="rounded-md border border-red-400/50 bg-red-500/10 px-2.5 py-1 text-[12px] text-red-400 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
			>
				{t("common.retry")}
			</button>
		</div>
	);
}
