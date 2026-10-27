import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorMessage } from "../../../core/api";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Spinner } from "../../../ui/Spinner";
import { PageHeader } from "../../../ui/PageHeader";
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

/** Full, selectable error text. Never truncated. */
export function ErrorBox({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
	return (
		<div role="alert" className="m-3 rounded-m-md border border-m-danger bg-m-surface p-3">
			{title && <div className="mb-1 text-m-sm font-semibold text-m-danger">{title}</div>}
			<div className="select-text whitespace-pre-wrap break-words text-m-sm text-m-text">{message}</div>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="mt-3 min-h-11 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface-2 px-4 text-m-sm text-m-text"
				>
					重试
				</button>
			)}
		</div>
	);
}

export function SettingsPageFrame({
	title,
	subtitle,
	loading,
	error,
	onRetry,
	children,
}: {
	title: string;
	subtitle?: string;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	children: ReactNode;
}) {
	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title={title} subtitle={subtitle} />
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--m-safe-bottom)+16px)]">
				{loading && (
					<div className="flex justify-center p-6">
						<Spinner />
					</div>
				)}
				{error && <ErrorBox title="读取失败" message={error} onRetry={onRetry} />}
				{!error && children}
			</div>
		</div>
	);
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 pt-4 pb-2">
			<span className="text-m-sm font-semibold text-m-text-2">{title}</span>
			{hint && <span className="whitespace-nowrap text-m-xs text-m-text-3">{hint}</span>}
		</div>
	);
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
	return (
		<span
			className={`inline-flex whitespace-nowrap rounded-m-pill border px-2 py-0.5 text-m-xs ${
				tone === "accent" ? "border-m-accent text-m-accent" : "border-m-border text-m-text-3"
			}`}
		>
			{children}
		</span>
	);
}

export function Btn({
	children,
	onClick,
	kind = "neutral",
	disabled,
	type = "button",
	label,
}: {
	children: ReactNode;
	onClick?: () => void;
	kind?: "neutral" | "primary" | "danger";
	disabled?: boolean;
	type?: "button" | "submit";
	label?: string;
}) {
	const cls =
		kind === "primary"
			? "border-m-accent bg-m-accent text-m-accent-text"
			: kind === "danger"
				? "border-m-danger bg-m-surface text-m-danger"
				: "border-m-border bg-m-surface-2 text-m-text";
	return (
		<button
			type={type}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-m-pill border px-4 text-m-sm disabled:opacity-40 ${cls}`}
		>
			{children}
		</button>
	);
}

/** Cancel / save footer for edit sheets. */
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
		<div className="flex gap-2 p-3">
			{onBack ? <Btn onClick={onBack}>上一步</Btn> : <Btn onClick={onCancel}>取消</Btn>}
			<div className="flex-1" />
			<Btn kind="primary" onClick={onSave} disabled={saveDisabled || busy}>
				{busy ? "保存中" : saveText}
			</Btn>
		</div>
	);
}

/** Diff-style before → after confirmation. Errors from the save are shown in full, selectable. */
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
			<div className="flex flex-col gap-3 px-4 pb-3">
				{rows.length === 0 && <div className="text-m-sm text-m-text-3">没有改动</div>}
				{rows.map((r) => (
					<div key={r.label} className="overflow-hidden rounded-m-md border border-m-border">
						<div className="bg-m-surface-2 px-3 py-1 text-m-xs text-m-text-2">{r.label}</div>
						<div className="select-text break-all bg-m-diff-del px-3 py-2 font-m-mono text-m-xs text-m-text">
							<span className="mr-2 text-m-danger">−</span>
							{r.before}
						</div>
						<div className="select-text break-all bg-m-diff-add px-3 py-2 font-m-mono text-m-xs text-m-text">
							<span className="mr-2 text-m-success">+</span>
							{r.after}
						</div>
					</div>
				))}
				{error && <ErrorBox title="保存失败" message={error} />}
			</div>
		</BottomSheet>
	);
}
