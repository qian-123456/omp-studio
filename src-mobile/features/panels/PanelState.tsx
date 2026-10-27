import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, Spinner } from "../../ui";

export function Loading({ label = "加载中" }: { label?: string }) {
	return (
		<div className="flex flex-1 items-center justify-center gap-2 py-16 text-m-sm text-m-text-3">
			<Spinner />
			<span className="whitespace-nowrap">{label}</span>
		</div>
	);
}

export function RetryButton({ onClick, label = "重试" }: { onClick: () => void; label?: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="min-h-11 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-5 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
		>
			{label}
		</button>
	);
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<EmptyState
			icon={<AlertCircle size={32} />}
			title="加载失败"
			hint={<span className="break-words">{message}</span>}
			action={<RetryButton onClick={onRetry} />}
		/>
	);
}

/** Standard loading / error / empty / content switch for a listing. */
export function LoadGate<T>({
	state,
	children,
}: {
	state: { data: T | null; error: string | null; loading: boolean; reload: (silent?: boolean) => Promise<void> };
	children: (data: T) => ReactNode;
}) {
	if (state.loading && state.data === null) return <Loading />;
	if (state.error !== null && state.data === null) return <ErrorState message={state.error} onRetry={() => void state.reload()} />;
	if (state.data === null) return null;
	return <>{children(state.data)}</>;
}

/** Small action button with a visible shape and a 44px touch target. */
export function ActionButton({
	children,
	onClick,
	disabled,
	tone = "neutral",
	className = "",
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	tone?: "neutral" | "primary" | "danger";
	className?: string;
}) {
	const tones = {
		neutral: "border border-m-border bg-m-surface text-m-text active:bg-m-surface-hover",
		primary: "bg-m-accent text-m-accent-text active:opacity-80",
		danger: "border border-m-danger text-m-danger active:bg-m-surface-hover",
	};
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-m-pill px-4 text-m-sm font-medium disabled:opacity-40 ${tones[tone]} ${className}`}
		>
			{children}
		</button>
	);
}
