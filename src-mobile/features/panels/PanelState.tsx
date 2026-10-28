import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, Spinner } from "../../ui";

export function Loading({ label = "加载中" }: { label?: string }) {
	return (
		<div className="flex flex-1 items-center justify-center gap-2 py-16 text-m-sm text-m-text-3">
			<Spinner />
			<span className="whitespace-nowrap">{label}</span>
		</div>
	);
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<EmptyState
			icon={<AlertCircle size={26} strokeWidth={1.75} />}
			title="加载失败"
			hint={<span className="m-selectable break-words">{message}</span>}
			action={<Button onClick={onRetry}>重试</Button>}
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
