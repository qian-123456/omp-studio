import { useMemo, useState } from "react";
import { Search } from "lucide-react";

/** Minimal catalog model shape (mirrors the backend `Model` contract). */
export interface PickerModel {
	provider: string;
	id: string;
	name?: string;
	thinking?: string[];
	contextWindow?: number | null;
	reasoning?: boolean | null;
}

export interface PickerValue {
	provider: string;
	modelId: string;
}

export interface ProviderGroup {
	provider: string;
	models: PickerModel[];
}

export const ALL_PROVIDERS = "*";

/** Group models by provider, keeping first-seen provider order. */
export function groupModels(models: PickerModel[]): ProviderGroup[] {
	const order: string[] = [];
	const by = new Map<string, PickerModel[]>();
	for (const m of models) {
		let list = by.get(m.provider);
		if (!list) {
			list = [];
			by.set(m.provider, list);
			order.push(m.provider);
		}
		list.push(m);
	}
	return order.map((provider) => ({ provider, models: by.get(provider) ?? [] }));
}

/** Search flattens across providers: every term must match provider, id or name. */
export function filterModels(models: PickerModel[], query: string): PickerModel[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return models;
	return models.filter((m) => {
		const hay = `${m.provider} ${m.id} ${m.name ?? ""}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	});
}

export const THINKING_AUTO = "auto";
export const THINKING_OFF = "off";

/**
 * Thinking choices for a model, taken from its catalog capabilities.
 * Empty when the catalog lists no levels. `null` value = auto (omit suffix).
 */
export function thinkingOptions(model: PickerModel | undefined): { value: string | null; label: string }[] {
	const levels = (model?.thinking ?? []).filter((l) => l !== THINKING_AUTO && l !== THINKING_OFF);
	if (!levels.length) return [];
	return [
		{ value: null, label: "自动" },
		...levels.map((l) => ({ value: l, label: l })),
		{ value: THINKING_OFF, label: "关闭" },
	];
}

export function ModelPicker({
	value,
	onChange,
	models,
	thinking,
	className = "",
}: {
	value: PickerValue | null;
	onChange: (model: PickerModel) => void;
	models: PickerModel[];
	/** When given, a thinking-level chip row for the selected model is shown. */
	thinking?: { value: string | null; onChange: (level: string | null) => void };
	className?: string;
}) {
	const groups = useMemo(() => groupModels(models), [models]);
	const [query, setQuery] = useState("");
	const [pane, setPane] = useState<string>(() => value?.provider ?? groups[0]?.provider ?? ALL_PROVIDERS);
	const searching = query.trim().length > 0;
	const shown = useMemo(() => {
		if (searching) return filterModels(models, query);
		return groups.find((g) => g.provider === pane)?.models ?? [];
	}, [searching, models, query, groups, pane]);
	const selected = value ? models.find((m) => m.provider === value.provider && m.id === value.modelId) : undefined;
	const options = thinking ? thinkingOptions(selected) : [];

	return (
		<div className={`flex min-h-0 flex-col gap-2 ${className}`}>
			<label className="flex min-h-11 items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3">
				<Search size={16} className="shrink-0 text-m-text-3" aria-hidden />
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="搜索模型或供应商"
					aria-label="搜索模型"
					className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none"
				/>
			</label>
			<div className="flex min-h-0 flex-1 gap-2">
				{!searching && (
					<div className="flex w-28 shrink-0 flex-col gap-1 overflow-y-auto" role="tablist" aria-label="供应商">
						{groups.map((g) => (
							<button
								key={g.provider}
								type="button"
								role="tab"
								aria-selected={pane === g.provider}
								onClick={() => setPane(g.provider)}
								className={`min-h-11 whitespace-nowrap rounded-m-md border px-2 text-left text-m-sm ${
									pane === g.provider
										? "border-m-accent bg-m-surface-2 text-m-text"
										: "border-m-border bg-m-surface text-m-text-2"
								}`}
							>
								<span className="block overflow-x-auto">{g.provider}</span>
							</button>
						))}
					</div>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="模型">
					{shown.length === 0 && <div className="p-3 text-m-sm text-m-text-3">没有匹配的模型</div>}
					{shown.map((m) => {
						const active = !!value && value.provider === m.provider && value.modelId === m.id;
						return (
							<button
								key={`${m.provider}/${m.id}`}
								type="button"
								role="option"
								aria-selected={active}
								onClick={() => onChange(m)}
								className={`min-h-11 rounded-m-md border px-3 py-2 text-left ${
									active ? "border-m-accent bg-m-surface-2" : "border-m-border bg-m-surface"
								}`}
							>
								<div className="break-words text-m-md text-m-text">{m.name || m.id}</div>
								<div className="break-all font-m-mono text-m-xs text-m-text-3">
									{searching ? `${m.provider}/${m.id}` : m.id}
								</div>
							</button>
						);
					})}
				</div>
			</div>
			{thinking && options.length > 0 && (
				<div className="flex flex-col gap-1">
					<div className="text-m-xs text-m-text-3">思考深度</div>
					<div className="flex flex-wrap gap-2">
						{options.map((o) => {
							const active = (thinking.value ?? null) === o.value;
							return (
								<button
									key={o.label}
									type="button"
									aria-pressed={active}
									onClick={() => thinking.onChange(o.value)}
									className={`min-h-11 whitespace-nowrap rounded-m-pill border px-4 text-m-sm ${
										active
											? "border-m-accent bg-m-accent text-m-accent-text"
											: "border-m-border bg-m-surface text-m-text-2"
									}`}
								>
									{o.label}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
