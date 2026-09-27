import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isComposing } from "../lib/hooks";
import { type ModelOption, toModelKey } from "../lib/models";

export interface ModelExtraOption {
	/** Value reported via onSelect; e.g. "" or "__custom_model". */
	value: string;
	label: string;
	hint?: string;
}

interface MenuProps {
	models: ModelOption[] | null;
	currentValue?: string;
	onSelect: (modelKey: string) => void;
	/** Extra rows rendered as a footer section (e.g. "默认", "自定义模型…"). */
	extras?: ModelExtraOption[];
	/** Header caption above the picker. */
	caption?: string;
}

/**
 * Two-pane model picker like the OMP TUI:
 * left column lists providers, right column lists that provider's models.
 * Typing in the search box switches to a flat filtered list across providers.
 */
export function ModelMenuContent({
	models,
	currentValue,
	onSelect,
	extras,
	caption,
}: MenuProps) {
	const [q, setQ] = useState("");
	const listRef = useRef<HTMLDivElement>(null);

	const providers = useMemo(() => {
		const map = new Map<string, ModelOption[]>();
		for (const m of models ?? []) {
			const arr = map.get(m.provider) ?? [];
			arr.push(m);
			map.set(m.provider, arr);
		}
		return [...map.entries()];
	}, [models]);

	const currentProvider = useMemo(() => {
		if (!currentValue) return null;
		const found = providers.find(([, list]) =>
			list.some((m) => toModelKey(m.provider, m.id) === currentValue),
		);
		return found?.[0] ?? null;
	}, [providers, currentValue]);

	const [activeProvider, setActiveProvider] = useState<string | null>(null);
	const effectiveProvider = activeProvider ?? currentProvider ?? providers[0]?.[0] ?? null;

	const searching = q.trim().length > 0;
	const searchHits = useMemo(() => {
		if (!searching) return [];
		const needle = q.trim().toLowerCase();
		return (models ?? []).filter(
			(m) =>
				m.name.toLowerCase().includes(needle) ||
				m.id.toLowerCase().includes(needle) ||
				m.provider.toLowerCase().includes(needle),
		);
	}, [models, q, searching]);

	const activeModels = useMemo(
		() => providers.find(([p]) => p === effectiveProvider)?.[1] ?? [],
		[providers, effectiveProvider],
	);

	if (models === null) {
		return (
			<div className="flex items-center gap-2 p-2.5 text-xs text-neutral-400">
				<Loader2 size={13} className="animate-spin text-neutral-400" />
				<span>加载模型列表中…</span>
			</div>
		);
	}

	const renderModelRow = (m: ModelOption, indent: boolean) => {
		const key = toModelKey(m.provider, m.id);
		const isSelected = currentValue === key;
		return (
			<button
				key={key}
				type="button"
				onClick={() => onSelect(key)}
				className={clsx(
					"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
					indent && "pl-4",
					isSelected
						? "bg-indigo-600/20 text-indigo-300"
						: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
				)}
			>
				<div className="min-w-0 pr-2">
					<div className="truncate font-medium">{m.name}</div>
					{m.name !== m.id && (
						<div className="truncate text-[10px] text-neutral-500">{m.id}</div>
					)}
					{searching && (
						<div className="truncate text-[10px] text-neutral-500">
							{m.provider}
						</div>
					)}
				</div>
				{isSelected && <Check size={13} className="shrink-0 text-indigo-400" />}
			</button>
		);
	};

	return (
		<div>
			{caption && (
				<div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-neutral-400">
					{caption}
				</div>
			)}
			{models.length > 5 && (
				<div className="border-b border-neutral-800 px-2 pb-1.5 pt-1">
					<div className="flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200">
						<Search size={12} className="text-neutral-500" />
						<input
							type="text"
							autoFocus
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索模型或 provider…"
							className="w-full bg-transparent outline-none placeholder:text-neutral-600"
						/>
					</div>
				</div>
			)}

			{searching ? (
				<div ref={listRef} className="max-h-64 overflow-y-auto py-0.5">
					{searchHits.length === 0 ? (
						<div className="px-3 py-2 text-center text-xs text-neutral-500">
							无匹配模型
						</div>
					) : (
						searchHits.map((m) => renderModelRow(m, false))
					)}
				</div>
			) : (
				<div className="flex max-h-64">
					{/* Provider column */}
					<div className="w-auto min-w-36 max-w-52 shrink-0 overflow-y-auto border-r border-neutral-800 py-0.5">
						{providers.map(([provider, list]) => {
							const active = provider === effectiveProvider;
							return (
								<button
									key={provider}
									type="button"
									onClick={() => setActiveProvider(provider)}
									className={clsx(
										"flex w-full items-center justify-between gap-1 px-2.5 py-1.5 text-left text-xs transition-colors",
										active
											? "bg-neutral-800 font-medium text-neutral-100"
											: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
									)}
								>
									<span className="truncate" title={provider}>{provider}</span>
									<span className="ml-1 flex shrink-0 items-center gap-0.5 text-[10px] text-neutral-600">
										{list.length}
										<ChevronRight size={10} />
									</span>
								</button>
							);
						})}
					</div>
					{/* Model column */}
					<div ref={listRef} className="min-w-0 flex-1 overflow-y-auto py-0.5">
						{activeModels.length === 0 ? (
							<div className="px-3 py-2 text-center text-xs text-neutral-500">
								该 provider 下无模型
							</div>
						) : (
							activeModels.map((m) => renderModelRow(m, false))
						)}
					</div>
				</div>
			)}

			{extras && extras.length > 0 && (
				<div className="border-t border-neutral-800">
					{extras.map((x) => (
						<button
							key={x.value}
							type="button"
							onClick={() => onSelect(x.value)}
							className={clsx(
								"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
								currentValue === x.value
									? "bg-indigo-600/20 text-indigo-300"
									: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100",
							)}
						>
							<span className="truncate">{x.label}</span>
							{x.hint ? (
								<span className="ml-1 shrink-0 text-[10px] text-neutral-500">
									{x.hint}
								</span>
							) : currentValue === x.value ? (
								<Check size={13} className="shrink-0 text-indigo-400" />
							) : null}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

interface SelectProps extends MenuProps {
	/** Button label (usually the current model label). */
	label: string;
	buttonClass?: string;
	icon?: boolean;
	/** Popover direction; Composer opens upward. */
	direction?: "up" | "down";
	widthClass?: string;
}

/** Trigger button + two-pane grouped popover menu. */
export function ModelSelect({
	label,
	buttonClass,
	icon = true,
	direction = "down",
	widthClass = "w-[420px]",
	...menu
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				e.stopPropagation();
				e.preventDefault();
				setOpen(false);
				buttonRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open]);

	return (
		<div className="relative">
			<button
				ref={buttonRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				title={label || "选择模型"}
				className={buttonClass}
			>
				{icon && <ChevronDown size={11} className="shrink-0 text-neutral-500" />}
				<span className="truncate">{label}</span>
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} />
					<div
						className={clsx(
							"absolute z-40 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl",
							widthClass,
							direction === "up" ? "bottom-full left-0 mb-1" : "left-0 top-full mt-1",
						)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								if (isComposing(e)) return;
								e.stopPropagation();
								e.preventDefault();
								setOpen(false);
								buttonRef.current?.focus();
							}
						}}
					>
						<ModelMenuContent
							{...menu}
							onSelect={(v) => {
								menu.onSelect(v);
								setOpen(false);
								buttonRef.current?.focus();
							}}
						/>
					</div>
				</>
			)}
		</div>
	);
}
