import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { type ModelOption, toModelKey } from "../lib/models";
import { FloatingLayer } from "./FloatingLayer";
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
					"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors rounded-md",
					indent && "pl-4",
					isSelected
						? "bg-[#0A84FF]/15 text-[#70b1ff] font-medium"
						: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
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
				{isSelected && <Check size={13} className="shrink-0 text-[#0A84FF]" />}
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
				<div className="border-b border-[var(--border-divider)] px-2 pb-1.5 pt-1">
					<div className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg)] px-2 py-1 text-xs text-neutral-200">
						<Search size={12} className="text-neutral-500" />
						<input
							type="text"
							autoFocus
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索模型或 provider…"
							className="w-full bg-transparent outline-none placeholder:text-neutral-500"
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
					<div className="w-auto min-w-36 max-w-52 shrink-0 overflow-y-auto border-r border-[var(--border-divider)] py-0.5">
						{providers.map(([provider, list]) => {
							const active = provider === effectiveProvider;
							return (
								<button
									key={provider}
									type="button"
									onClick={() => setActiveProvider(provider)}
									className={clsx(
										"flex w-full items-center justify-between gap-1 px-2.5 py-1.5 text-left text-xs transition-colors rounded-md",
										active
											? "bg-[var(--bg-active-fill)] font-medium text-[var(--text)]"
											: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
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
				<div className="border-t border-[var(--border-divider)] mt-1 pt-1">
					{extras.map((x) => (
						<button
							key={x.value}
							type="button"
							onClick={() => onSelect(x.value)}
							className={clsx(
								"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors rounded-md",
								currentValue === x.value
									? "bg-[#0A84FF]/15 text-[#70b1ff] font-medium"
									: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
						>
							<span className="truncate">{x.label}</span>
							{x.hint ? (
								<span className="ml-1 shrink-0 text-[10px] text-neutral-500">
									{x.hint}
								</span>
							) : currentValue === x.value ? (
								<Check size={13} className="shrink-0 text-[#0A84FF]" />
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
			<FloatingLayer
				anchor={open ? buttonRef.current : null}
				placement={direction === "up" ? "top-start" : "bottom-start"}
				offset={4}
				layer="popover"
				ignoreRefs={[buttonRef]}
				onDismiss={() => {
					setOpen(false);
					buttonRef.current?.focus();
				}}
				className={clsx("py-1.5", widthClass)}
			>
				<ModelMenuContent
					{...menu}
					onSelect={(v) => {
						menu.onSelect(v);
						setOpen(false);
						buttonRef.current?.focus();
					}}
				/>
			</FloatingLayer>
		</div>
	);
}
