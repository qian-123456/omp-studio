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
	return (
		<>
			{state.error !== null && (
				<div role="alert" className="mx-4 mt-2 flex items-start gap-3 rounded-m-md bg-m-warn-bg px-4 py-2 text-m-sm text-m-warn">
					<AlertCircle size={18} className="mt-3 shrink-0" />
					<p className="m-selectable min-w-0 flex-1 self-center break-words">刷新失败，仍显示上次内容。{state.error}</p>
					<Button size="sm" onClick={() => void state.reload()}>重试</Button>
				</div>
			)}
			{children(state.data)}
		</>
	);
}
