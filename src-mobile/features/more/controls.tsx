import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { errorMessage } from "../../core/api";

/** Loads data on mount; `reload` refetches without clearing existing data (pull-to-refresh friendly). */
export function useLoad<T>(fn: () => Promise<T>, deps: ReadonlyArray<unknown> = []) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const fnRef = useRef(fn);
	fnRef.current = fn;
	const seq = useRef(0);
	const reload = useCallback(async () => {
		const mine = ++seq.current;
		try {
			const v = await fnRef.current();
			if (mine !== seq.current) return;
			setData(v);
			setError(null);
		} catch (e) {
			if (mine === seq.current) setError(errorMessage(e, "加载失败"));
		} finally {
			if (mine === seq.current) setLoading(false);
		}
	}, []);
	useEffect(() => {
		setLoading(true);
		void reload();
		return () => {
			seq.current++;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	return { data, setData, error, loading, reload };
}

export const inputCls =
	"min-h-11 w-full rounded-m-md border border-m-border bg-m-surface px-3 text-m-md text-m-text outline-none focus:border-m-accent";

export function Field({
	label,
	error,
	hint,
	children,
}: {
	label: string;
	error?: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="whitespace-nowrap text-m-sm font-medium text-m-text-2">{label}</span>
			{children}
			{hint && !error && <span className="text-m-xs text-m-text-3">{hint}</span>}
			{error && (
				<span role="alert" className="text-m-sm text-m-danger">
					{error}
				</span>
			)}
		</div>
	);
}

export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className="relative flex h-11 w-14 shrink-0 items-center justify-center disabled:opacity-50"
		>
			<span
				className={`flex h-7 w-12 items-center rounded-m-pill border border-m-border px-0.5 transition-colors ${
					checked ? "justify-end bg-m-accent" : "justify-start bg-m-surface-2"
				}`}
			>
				<span className="h-6 w-6 rounded-m-pill bg-m-bg shadow-m-pop" />
			</span>
		</button>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: ReadonlyArray<readonly [T, string]>;
	onChange: (v: T) => void;
	label: string;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex rounded-m-md border border-m-border bg-m-surface p-0.5">
			{options.map(([v, text]) => (
				<button
					key={v}
					type="button"
					role="radio"
					aria-checked={v === value}
					onClick={() => onChange(v)}
					className={`min-h-10 flex-1 whitespace-nowrap rounded-m-sm px-2 text-m-sm font-medium ${
						v === value ? "bg-m-accent text-m-accent-text" : "text-m-text-2 active:bg-m-surface-hover"
					}`}
				>
					{text}
				</button>
			))}
		</div>
	);
}

export const btnCls =
	"inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-m-md border border-m-border bg-m-surface px-4 text-m-md font-medium text-m-text active:bg-m-surface-hover disabled:opacity-50";
export const btnPrimaryCls =
	"inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-m-md bg-m-accent px-4 text-m-md font-medium text-m-accent-text active:opacity-80 disabled:opacity-50";
export const btnDangerCls =
	"inline-flex min-h-11 items-center justify-center gap-1 whitespace-nowrap rounded-m-md border border-m-danger bg-m-surface px-4 text-m-md font-medium text-m-danger active:bg-m-surface-hover disabled:opacity-50";

/** Full-page body states: loading spinner / error with retry. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
	if (loading) return <div className="flex flex-1 items-center justify-center py-16 text-m-text-3">加载中</div>;
	if (error)
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
				<div className="text-m-md text-m-danger">{error}</div>
				<button type="button" onClick={onRetry} className={btnCls}>
					重试
				</button>
			</div>
		);
	return null;
}
