import clsx from "clsx";
import { Brain, Check, ChevronDown, ChevronRight, CornerDownLeft, Loader2, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { asRecord } from "../features/settings/modelRoles";
import { useOmpConfigStore } from "../features/settings/ompConfigStore";
import { openSettingsTarget } from "../features/settings/settingsTargets";
import { type ModelOption, toModelKey } from "../lib/models";
import { useModelCatalog } from "../stores/modelCatalog";
import { FloatingLayer } from "./FloatingLayer";
import {
	RESOLVABLE_ROLES,
	composeSelection,
	describeResolution,
	isRecordableModelKey,
	parseSelection,
	resolveRole,
	roleIdOf,
} from "./modelSelectLogic";
import { useModelSelectPrefs } from "./modelSelectPrefs";
export interface ModelExtraOption {
	/** Value reported via onSelect; e.g. "" for a default row. */
	value: string;
	label: string;
	hint?: string;
}

interface MenuProps {
	models: ModelOption[] | null;
	/** Stored value; may carry a `:<level>` thinking suffix (e.g. "smol:high"). */
	currentValue?: string;
	/** `keepOpen` is set for thinking-level picks so the menu stays open. */
	onSelect: (modelKey: string, opts?: { keepOpen?: boolean }) => void;
	/** Extra rows rendered as a footer section (e.g. "默认", "自定义模型…"). */
	extras?: ModelExtraOption[];
	/** Header caption above the picker. */
	caption?: string;
	/** Show the thinking-level strip for the selected model/role. */
	thinking?: boolean;
	/**
	 * Let the typed search text be used verbatim as a selector (e.g. a model
	 * missing from the catalog, `@smol`, `web/duckduckgo`). Replaces the old
	 * "自定义模型…" footer rows.
	 */
	allowCustom?: boolean;
	/** Explicit role map for the current scope; bypasses the global omp config store. */
	roles?: Record<string, unknown>;
	/** Close after any model or thinking pick and never hold a local (optimistic) selection. */
	closeOnSelect?: boolean;
}

const EMPTY_ENTRIES: never[] = [];

/** omp `modelRoles`: explicit `override` wins, else loaded on demand from the global store. */
function useOmpModelRoles(
	enabled: boolean,
	override?: Record<string, unknown>,
): { roles: Record<string, unknown>; loaded: boolean } {
	const useStore = enabled && !override;
	const entries = useOmpConfigStore((s) => (useStore ? s.entries : EMPTY_ENTRIES));
	const loaded = useOmpConfigStore((s) => s.loaded);
	const load = useOmpConfigStore((s) => s.load);
	useEffect(() => {
		if (useStore) void load();
	}, [useStore, load]);
	const roles = useMemo(
		() => override ?? asRecord(entries.find((e) => e.key === "modelRoles")?.value),
		[override, entries],
	);
	return { roles, loaded: override ? enabled : useStore && loaded };
}

function findCatalogModel(models: ModelOption[] | null, key: string): ModelOption | null {
	return models?.find((m) => toModelKey(m.provider, m.id) === key) ?? null;
}

const ROW_CLASS =
	"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors rounded-[8px]";
const ROW_IDLE =
	"text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]";
const ROW_SELECTED = "bg-[var(--bg-active-fill)] text-[var(--text)] font-medium";

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
	thinking = false,
	allowCustom = false,
	roles: rolesOverride,
	closeOnSelect = false,
}: MenuProps) {
	const [q, setQ] = useState("");
	const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | null>(null);
	const [localSelection, setLocalSelection] = useState<string | null>(null);
	const hasRoleExtras = Boolean(extras?.some((x) => roleIdOf(x.value)));
	const effectiveValue = localSelection ?? currentValue;
	const current = parseSelection(effectiveValue);
	const selectedKey = current.selector;
	const { roles, loaded: rolesLoaded } = useOmpModelRoles(
		hasRoleExtras || (thinking && roleIdOf(selectedKey) !== null),
		rolesOverride,
	);
	const recent = useModelSelectPrefs((s) => s.recent);
	const recordRecent = useModelSelectPrefs((s) => s.recordRecent);
	const removeRecent = useModelSelectPrefs((s) => s.removeRecent);
	const dismissedGuides = useModelSelectPrefs((s) => s.dismissedGuides);
	const dismissGuide = useModelSelectPrefs((s) => s.dismissGuide);
	const refreshing = useModelCatalog((s) => s.loading);
	const refreshCatalog = useModelCatalog((s) => s.refresh);
	// Every open re-fetches the catalog so picks reflect `omp update`; the
	// cached list renders immediately and updates in place.
	useEffect(() => {
		void refreshCatalog();
	}, [refreshCatalog]);

	const recentModels = useMemo(
		() =>
			recent
				.map((k) => findCatalogModel(models, k))
				.filter((m): m is ModelOption => m !== null),
		[recent, models],
	);

	const pickModel = (key: string) => {
		if (isRecordableModelKey(key)) recordRecent(key);
		if (!closeOnSelect) setLocalSelection(key);
		const targetModel = findCatalogModel(models, key);
		const supportsThinking =
			!closeOnSelect && thinking && targetModel && (targetModel.thinking?.length ?? 0) > 0;
		if (supportsThinking) {
			onSelect(key, { keepOpen: true });
		} else {
			onSelect(key);
		}
	};
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
			list.some((m) => toModelKey(m.provider, m.id) === selectedKey),
		);
		return found?.[0] ?? null;
	}, [providers, selectedKey]);

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
	const customQuery = q.trim();
	const showCustomRow =
		allowCustom &&
		searching &&
		!customQuery.startsWith("-") &&
		!searchHits.some((m) => toModelKey(m.provider, m.id) === customQuery);

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

	const renderModelRow = (m: ModelOption, showProvider: boolean, keyPrefix = "") => {
		const key = toModelKey(m.provider, m.id);
		const isSelected = selectedKey === key;
		return (
			<button
				key={keyPrefix + key}
				type="button"
				onClick={() => pickModel(key)}
				className={clsx(ROW_CLASS, isSelected ? ROW_SELECTED : ROW_IDLE)}
			>
				<div className="min-w-0 pr-2">
					<div className="truncate font-medium">{m.id}</div>
					{showProvider && (
						<div className="truncate text-[10px] text-neutral-500">
							{m.provider}
						</div>
					)}
				</div>
				{isSelected && <Check size={13} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />}
			</button>
		);
	};

	const renderRecentModelRow = (m: ModelOption) => {
		const key = toModelKey(m.provider, m.id);
		const isSelected = selectedKey === key;
		const isConfirming = confirmRemoveKey === key;

		if (isConfirming) {
			return (
				<div
					key={"recent:" + key}
					className="flex w-full items-center justify-between gap-1.5 px-2.5 py-1 text-xs rounded-[8px] bg-red-500/10 border border-red-500/25 my-0.5"
				>
					<span className="min-w-0 truncate text-[11px] font-medium text-red-400">
						确认移出最近记录？
					</span>
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								removeRecent(key);
								setConfirmRemoveKey(null);
							}}
							className="rounded px-2 py-0.5 text-[10px] font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors cursor-pointer"
						>
							确认
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setConfirmRemoveKey(null);
							}}
							className="rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors cursor-pointer"
						>
							取消
						</button>
					</div>
				</div>
			);
		}

		return (
			<div
				key={"recent:" + key}
				className={clsx(
					"group relative flex w-full items-center justify-between px-2.5 py-1 text-left text-xs transition-colors rounded-[8px]",
					isSelected ? ROW_SELECTED : ROW_IDLE,
				)}
			>
				<button
					type="button"
					onClick={() => pickModel(key)}
					className="flex min-w-0 flex-1 items-center justify-between text-left cursor-pointer"
				>
					<div className="min-w-0 pr-2">
						<div className="truncate font-medium">{m.id}</div>
						<div className="truncate text-[10px] text-neutral-500">{m.provider}</div>
					</div>
					{isSelected && <Check size={13} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />}
				</button>
				<button
					type="button"
					title="移出最近记录"
					aria-label="移出最近记录"
					onClick={(e) => {
						e.stopPropagation();
						setConfirmRemoveKey(key);
					}}
					className="ml-1 shrink-0 rounded p-1 text-neutral-500 opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-red-400 transition-all cursor-pointer"
				>
					<Trash2 size={12} />
				</button>
			</div>
		);
	};

	return (
		<div className="flex min-h-0 flex-col">
			{(caption || refreshing) && (
				<div className="flex shrink-0 items-center justify-between gap-2 px-2.5 pb-1 pt-2 text-[11px] font-medium text-neutral-400">
					<span className="truncate">{caption}</span>
					{refreshing && (
						<Loader2
							size={11}
							className="shrink-0 animate-spin text-neutral-500"
							aria-label="正在刷新模型列表"
						/>
					)}
				</div>
			)}
			{(models.length > 5 || allowCustom) && (
				<div className="shrink-0 border-b border-[var(--border-divider)] px-2 pb-1.5 pt-1">
					<div className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg)] px-2 py-1 text-xs text-neutral-200">
						<Search size={12} className="text-neutral-500" />
						<input
							type="text"
							autoFocus
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={(e) => {
								if (e.key !== "Enter" || !searching || e.nativeEvent.isComposing) return;
								e.preventDefault();
								const first = searchHits[0];
								if (first) pickModel(toModelKey(first.provider, first.id));
								else if (showCustomRow) onSelect(customQuery);
							}}
							placeholder={allowCustom ? "搜索模型，或直接输入模型标识…" : "搜索模型或 provider…"}
							className="w-full bg-transparent outline-none placeholder:text-neutral-500"
						/>
					</div>
				</div>
			)}

			{!searching && recentModels.length > 0 && (
				<div className="shrink-0 border-b border-[var(--border-divider)] pb-1">
					<div className="px-2.5 pb-0.5 pt-1 text-[10px] font-medium text-neutral-500">最近使用</div>
					{recentModels.map((m) => renderRecentModelRow(m))}
				</div>
			)}

			{searching ? (
				<div ref={listRef} className="max-h-56 min-h-28 shrink overflow-y-auto py-0.5">
					{searchHits.length === 0 && !showCustomRow ? (
						<div className="px-3 py-2 text-center text-xs text-neutral-500">
							无匹配模型
						</div>
					) : (
						searchHits.map((m) => renderModelRow(m, true))
					)}
					{showCustomRow && (
						<button
							type="button"
							onClick={() => onSelect(customQuery)}
							className={clsx(ROW_CLASS, ROW_IDLE, searchHits.length > 0 && "border-t border-[var(--border-divider)]")}
						>
							<span className="min-w-0 truncate">
								使用 <span className="font-mono text-[var(--text)]">{customQuery}</span>
								<span className="text-neutral-500"> 作为模型标识</span>
							</span>
							{searchHits.length === 0 && <CornerDownLeft size={12} className="shrink-0 text-neutral-500" />}
						</button>
					)}
				</div>
			) : (
				<div className="flex max-h-56 min-h-28 shrink">
					{/* Provider column */}
					<div className="w-36 shrink-0 overflow-y-auto border-r border-[var(--border-divider)] py-0.5">
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
				<div className="mt-1 max-h-40 min-h-12 shrink overflow-y-auto border-t border-[var(--border-divider)] pt-1">
					{extras.map((x) => {
						const roleId = roleIdOf(x.value);
						const isSelected = selectedKey === x.value;
						const resolution = roleId && rolesLoaded ? resolveRole(roles, roleId, models) : null;
						if (roleId && roleId !== "default" && resolution && resolution.kind !== "model") {
							if (dismissedGuides.includes(roleId)) return null;
							return (
								<div key={x.value} className={clsx(ROW_CLASS, "gap-1 text-neutral-500")}>
									<button
										type="button"
										onClick={() => openSettingsTarget("models")}
										className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]"
									>
										{x.label} 未配置 · 去配置 →
									</button>
									<button
										type="button"
										aria-label="不再提示"
										title="不再提示"
										onClick={() => dismissGuide(roleId)}
										className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<X size={11} />
									</button>
								</div>
							);
						}
						return (
							<button
								key={x.value}
								type="button"
								onClick={() => onSelect(x.value)}
								className={clsx(ROW_CLASS, isSelected ? ROW_SELECTED : ROW_IDLE)}
							>
								<span className="min-w-0 truncate">
									{x.label}
									{resolution && (
										<span className="text-neutral-500"> → {describeResolution(resolution)}</span>
									)}
								</span>
								{x.hint && !resolution ? (
									<span className="ml-1 shrink-0 text-[10px] text-neutral-500">{x.hint}</span>
								) : isSelected ? (
									<Check size={13} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />
								) : null}
							</button>
						);
					})}
				</div>
			)}

			{thinking && (
				<ThinkingStrip
					selector={selectedKey}
					level={current.level}
					models={models}
					roles={roles}
					rolesLoaded={rolesLoaded}
					onPick={(level) => {
						const next = composeSelection(selectedKey, level);
						if (!closeOnSelect) setLocalSelection(next);
						onSelect(next);
					}}
				/>
			)}
		</div>
	);
}

/** Bottom strip: `默认` + the thinking levels the selected (or role-resolved) model supports. */
function ThinkingStrip({
	selector,
	level,
	models,
	roles,
	rolesLoaded,
	onPick,
}: {
	selector: string;
	level: string | null;
	models: ModelOption[] | null;
	roles: Record<string, unknown>;
	rolesLoaded: boolean;
	onPick: (level: string | null) => void;
}) {
	if (!selector || selector.startsWith("__")) return null;
	const roleId = roleIdOf(selector);
	let model: ModelOption | null;
	if (roleId) {
		const r = rolesLoaded ? resolveRole(roles, roleId, models) : null;
		model = r && r.kind !== "auto" ? r.model : null;
	} else {
		model = findCatalogModel(models, selector);
		if (!model) return null;
	}
	const levels = model?.thinking ?? [];
	if (model && levels.length === 0) return null;
	const options: { value: string | null; label: string }[] = [
		{ value: null, label: roleId ? (model ? "跟随角色（默认）" : "跟随角色") : "默认" },
		...levels.map((l) => ({ value: l, label: l })),
	];
	return (
		<div className="mt-1 flex shrink-0 items-center gap-2 border-t border-[var(--border-divider)] px-2.5 pb-0.5 pt-1.5">
			<span className="flex shrink-0 select-none items-center gap-1 text-[10px] text-neutral-500">
				<Brain size={11} aria-hidden />
				思考强度
			</span>
			<div
				role="radiogroup"
				aria-label="思考强度"
				className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg hairline bg-[var(--well-bg,var(--bg))] p-0.5"
			>
				{options.map((o) => {
					const active = (level ?? null) === o.value;
					return (
						<button
							key={o.value ?? "__default"}
							type="button"
							role="radio"
							aria-checked={active}
							onClick={() => onPick(o.value)}
							className={clsx(
								"cursor-pointer rounded-md px-2 py-0.5 text-[11px] transition-colors",
								active
									? "bg-[var(--bg-active-fill)] font-medium text-[var(--text)] shadow-sm"
									: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
						>
							{o.label}
						</button>
					);
				})}
			</div>
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
	/** Horizontal alignment relative to trigger button; defaults to "end" to keep right-aligned dropdowns inside dialogs. */
	align?: "start" | "end";
	widthClass?: string;
	/** Real disabled trigger; also closes an open menu. */
	disabled?: boolean;
}

/** Trigger button + two-pane grouped popover menu. */
export function ModelSelect({
	label,
	buttonClass,
	icon = true,
	direction = "down",
	align = "end",
	widthClass = "w-[380px]",
	disabled = false,
	...menu
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const placement = `${direction === "up" ? "top" : "bottom"}-${align}` as const;
	const current = parseSelection(menu.currentValue);
	const currentRole = menu.extras?.some((x) => x.value === current.selector)
		? roleIdOf(current.selector)
		: null;
	const { roles, loaded } = useOmpModelRoles(currentRole !== null, menu.roles);
	let displayLabel = label;
	if (currentRole && loaded) {
		displayLabel = `${RESOLVABLE_ROLES[currentRole]} → ${describeResolution(
			resolveRole(roles, currentRole, menu.models),
			current.level,
		)}`;
	} else if (currentRole && current.level) {
		displayLabel = `${RESOLVABLE_ROLES[currentRole]} · ${current.level}`;
	} else if (current.level) {
		const name = findCatalogModel(menu.models, current.selector)?.id ?? current.selector;
		displayLabel = `${name} · ${current.level}`;
	}
	const isOpen = open && !disabled;
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	return (
		<div className="relative">
			<button
				ref={buttonRef}
				type="button"
				disabled={disabled}
				onClick={() => {
					if (!disabled) setOpen((v) => !v);
				}}
				title={displayLabel || "选择模型"}
				className={buttonClass}
			>
				{icon && <ChevronDown size={11} className="shrink-0 text-neutral-500" />}
				<span className="truncate">{displayLabel}</span>
			</button>
			<FloatingLayer
				anchor={isOpen ? buttonRef.current : null}
				placement={placement}
				offset={4}
				layer="popover"
				ignoreRefs={[buttonRef]}
				onDismiss={() => {
					setOpen(false);
					buttonRef.current?.focus();
				}}
				className={clsx(
					"flex flex-col py-1.5 rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)]",
					widthClass,
				)}
			>
				<ModelMenuContent
					{...menu}
					onSelect={(v, opts) => {
						if (disabled) return;
						menu.onSelect(v, opts);
						if (opts?.keepOpen) return;
						setOpen(false);
						buttonRef.current?.focus();
					}}
				/>
			</FloatingLayer>
		</div>
	);
}
