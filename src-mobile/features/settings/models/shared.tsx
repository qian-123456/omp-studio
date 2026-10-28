import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorMessage } from "../../../core/api";
import { BottomSheet, Button, PageHeader, Spinner } from "../../../ui";
import type { DiffRow } from "./logic";

export function useLoader<T>(load: (signal: AbortSignal) => Promise<T>): {
	data: T | null;
	error: string | null;
	loading: boolean;
	reload: () => void;
} {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [tick, setTick] = useState(0);
	const loadRef = useRef(load);
	loadRef.current = load;
	useEffect(() => {
		const ctl = new AbortController();
		setLoading(true);
		loadRef
			.current(ctl.signal)
			.then((d) => {
				if (ctl.signal.aborted) return;
				setData(d);
				setError(null);
			})
			.catch((e: unknown) => {
				if (ctl.signal.aborted) return;
				setError(errorMessage(e, "加载失败"));
			})
			.finally(() => {
				if (!ctl.signal.aborted) setLoading(false);
			});
		return () => ctl.abort();
	}, [tick]);
	const reload = useCallback(() => setTick((t) => t + 1), []);
	return { data, error, loading, reload };
}

/** Full, selectable error text on a soft danger block. Never truncated. */
export function ErrorBox({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
	return (
		<div role="alert" className="rounded-m-lg bg-m-danger-bg px-4 py-3.5">
			{title && <div className="mb-1 text-m-sm font-semibold text-m-danger">{title}</div>}
			<div className="m-selectable whitespace-pre-wrap break-words text-m-sm text-m-text">{message}</div>
			{onRetry && (
				<Button size="sm" variant="tonal" onClick={onRetry} className="mt-3">
					重试
				</Button>
			)}
		</div>
	);
}

/** Pushed settings sub-page: header + grouped cards on the elevated canvas. */
export function SettingsPageFrame({
	title,
	subtitle,
	right,
	loading,
	error,
	onRetry,
	children,
}: {
	title: string;
	subtitle?: string;
	right?: ReactNode;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader title={title} subtitle={subtitle} right={right} className="bg-m-bg-elev" />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--m-safe-bottom)+24px)]">
				<div className="flex flex-col gap-2 pt-1">
					{loading && (
						<div className="flex justify-center p-8">
							<Spinner />
						</div>
					)}
					{error && (
						<div className="px-4 pt-3">
							<ErrorBox title="读取失败" message={error} onRetry={onRetry} />
						</div>
					)}
					{!error && children}
				</div>
			</div>
		</div>
	);
}

/** Footer of edit sheets: 上一步/取消 on the left, the primary capsule on the right. */
export function SheetFooter({
	onCancel,
	onSave,
	saveText = "保存",
	saveDisabled,
	busy,
	onBack,
}: {
	onCancel: () => void;
	onSave: () => void;
	saveText?: string;
	saveDisabled?: boolean;
	busy?: boolean;
	onBack?: () => void;
}) {
	return (
		<div className="flex items-center gap-3">
			{onBack ? (
				<Button variant="tonal" onClick={onBack}>
					上一步
				</Button>
			) : (
				<Button variant="tonal" onClick={onCancel}>
					取消
				</Button>
			)}
			<div className="flex-1" />
			<Button variant="primary" onClick={onSave} disabled={saveDisabled} busy={busy}>
				{busy ? "保存中" : saveText}
			</Button>
		</div>
	);
}

/** Before → after confirmation. Errors from the save are shown in full, selectable. */
export function ConfirmDiffSheet({
	open,
	title,
	rows,
	busy,
	error,
	onCancel,
	onConfirm,
	onBack,
}: {
	open: boolean;
	title: string;
	rows: DiffRow[];
	busy: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: () => void;
	onBack?: () => void;
}) {
	return (
		<BottomSheet
			open={open}
			onClose={onCancel}
			title={title}
			footer={
				<SheetFooter
					onCancel={onCancel}
					onBack={onBack}
					onSave={onConfirm}
					saveText="确认保存"
					busy={busy}
					saveDisabled={rows.length === 0}
				/>
			}
		>
			<div className="flex flex-col gap-4 px-4 pt-1 pb-3">
				{rows.length === 0 && <div className="px-1 text-m-sm text-m-text-3">没有改动</div>}
				{rows.map((r) => (
					<div key={r.label} className="flex flex-col gap-2">
						<div className="px-1 text-m-xs font-medium break-words text-m-text-3">{r.label}</div>
						<div className="rounded-m-md bg-m-surface px-4 py-3">
							<div className="text-m-xs whitespace-nowrap text-m-text-3">修改前</div>
							<div className="m-selectable mt-1 whitespace-pre-wrap break-all font-m-mono text-m-sm text-m-text-2">{r.before}</div>
						</div>
						<div className="rounded-m-md bg-m-accent-soft px-4 py-3">
							<div className="text-m-xs whitespace-nowrap text-m-accent-soft-text opacity-80">修改后</div>
							<div className="m-selectable mt-1 whitespace-pre-wrap break-all font-m-mono text-m-sm text-m-accent-soft-text">{r.after}</div>
						</div>
					</div>
				))}
				{error && <ErrorBox title="保存失败" message={error} />}
			</div>
		</BottomSheet>
	);
}
