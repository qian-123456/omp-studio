import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, CornerDownLeft, Loader2, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { asRecord } from "../features/settings/modelRoles";
import { useOmpConfigStore } from "../features/settings/ompConfigStore";
import { openSettingsTarget } from "../features/settings/settingsTargets";
import { type ModelOption, toModelKey } from "../lib/models";
import { useModelCatalog } from "../stores/modelCatalog";
import { FloatingLayer } from "./FloatingLayer";
import { ThinkingLevelPicker } from "./ThinkingLevelPicker";
import {
	FOLLOW_LEVEL,
	RESOLVABLE_ROLES,
	type RoleResolution,
	applyThinkingLevel,
	carryLevel,
	describeResolution,
	isRecordableModelKey,
	parseSelection,
	resolveRole,
	roleIdOf,
	thinkingLevelsFor,
	thinkingModelFor,
} from "./modelSelectLogic";
import { useModelSelectPrefs } from "./modelSelectPrefs";
import { useT } from "../stores/language";
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
	onSelect: (modelKey: string) => void;
	/** Extra rows rendered as a footer section (e.g. "默认", "自定义模型…"). */
	extras?: ModelExtraOption[];
	/** Header caption above the picker. */
	caption?: string;
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

type GroupId = string;
const GROUP_COMMON: GroupId = "★";
const GROUP_ROLES: GroupId = "@roles";
const providerGroup = (p: string): GroupId => `p:${p}`;

type Entry =
	| { id: string; kind: "model"; m: ModelOption; showProvider: boolean; removable: boolean }
	| { id: string; kind: "extra"; x: ModelExtraOption; resolution: RoleResolution | null }
	| { id: string; kind: "custom" };

interface Section {
	title?: string;
	entries: Entry[];
}

const ROW_HI = "bg-[var(--bg-hover)] text-[var(--text)]";

/**
 * Two-pane model picker. Left column: ★ 常用 (plain extras + recent models),
 * 角色 (role extras, when the caller passes any), then one tab per provider.
 * Right column lists the active group. Typing switches to a flat search list.
 * Keyboard: ↑↓ move, ←→ switch group, Enter picks.
 */
export function ModelMenuContent({
	models,
	currentValue,
	onSelect,
	extras,
	caption,
	allowCustom = false,
	roles: rolesOverride,
	closeOnSelect = false,
}: MenuProps) {
	const { t } = useT();
	const [q, setQ] = useState("");
	const [localSelection, setLocalSelection] = useState<string | null>(null);
	const [group, setGroup] = useState<GroupId | null>(null);
	const [hi, setHi] = useState(-1);
	const [undo, setUndo] = useState<{ key: string; prev: string[] } | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const roleExtras = useMemo(() => (extras ?? []).filter((x) => roleIdOf(x.value)), [extras]);
	const plainExtras = useMemo(() => (extras ?? []).filter((x) => !roleIdOf(x.value)), [extras]);
	const effectiveValue = localSelection ?? currentValue;
	const current = parseSelection(effectiveValue);
	const selectedKey = current.selector;
	const { roles, loaded: rolesLoaded } = useOmpModelRoles(roleExtras.length > 0, rolesOverride);
	const recent = useModelSelectPrefs((s) => s.recent);
	const recordRecent = useModelSelectPrefs((s) => s.recordRecent);
	const removeRecent = useModelSelectPrefs((s) => s.removeRecent);
	const setRecent = useModelSelectPrefs((s) => s.setRecent);
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
		setUndo(null);
		onSelect(key);
	};

	const providers = useMemo(() => {
		const map = new Map<string, ModelOption[]>();
		for (const m of models ?? []) {
			const arr = map.get(m.provider) ?? [];
			arr.push(m);
			map.set(m.provider, arr);
		}
		return [...map.entries()];
	}, [models]);

	const hasCommon = plainExtras.length > 0 || recentModels.length > 0;
	const hasRoles = roleExtras.length > 0;
	const groupIds = useMemo<GroupId[]>(
		() => [
			...(hasCommon ? [GROUP_COMMON] : []),
			...(hasRoles ? [GROUP_ROLES] : []),
			...providers.map(([p]) => providerGroup(p)),
		],
		[hasCommon, hasRoles, providers],
	);

	// Open on where the current value lives: a role -> 角色, a model outside
	// 常用 -> its provider, otherwise the first group.
	const defaultGroup = useMemo<GroupId | null>(() => {
		if (hasRoles && roleExtras.some((x) => x.value === selectedKey)) return GROUP_ROLES;
		if (effectiveValue && !plainExtras.some((x) => x.value === selectedKey)) {
			const found = providers.find(([, list]) =>
				list.some((m) => toModelKey(m.provider, m.id) === selectedKey),
			);
			if (found && !recentModels.some((m) => toModelKey(m.provider, m.id) === selectedKey)) {
				return providerGroup(found[0]);
			}
		}
		return groupIds[0] ?? null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [groupIds]);
	const effectiveGroup =
		group !== null && groupIds.includes(group) ? group : (defaultGroup ?? groupIds[0] ?? null);

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

	const modelEntry = (m: ModelOption, showProvider: boolean, removable = false): Entry => ({
		id: `${removable ? "recent:" : "m:"}${toModelKey(m.provider, m.id)}`,
		kind: "model",
		m,
		showProvider,
		removable,
	});
	const extraEntry = (x: ModelExtraOption): Entry => {
		const roleId = roleIdOf(x.value);
		return {
			id: `x:${x.value}`,
			kind: "extra",
			x,
			resolution: roleId && rolesLoaded ? resolveRole(roles, roleId, models) : null,
		};
	};

	// Roles that resolve to nothing show a "go configure" guide instead of a row.
	const roleGuides: { x: ModelExtraOption; roleId: string }[] = [];
	const sections: Section[] = [];
	if (searching) {
		const entries: Entry[] = searchHits.map((m) => modelEntry(m, true));
		if (showCustomRow) entries.push({ id: "custom", kind: "custom" });
		sections.push({ entries });
	} else if (effectiveGroup === GROUP_COMMON) {
		if (plainExtras.length > 0) sections.push({ entries: plainExtras.map(extraEntry) });
		if (recentModels.length > 0) {
			sections.push({ title: t("models.recentModels"), entries: recentModels.map((m) => modelEntry(m, true, true)) });
		}
	} else if (effectiveGroup === GROUP_ROLES) {
		const entries: Entry[] = [];
		for (const x of roleExtras) {
			const e = extraEntry(x) as Extract<Entry, { kind: "extra" }>;
			const roleId = roleIdOf(x.value);
			if (roleId && roleId !== "default" && e.resolution && e.resolution.kind !== "model") {
				if (!dismissedGuides.includes(roleId)) roleGuides.push({ x, roleId });
			} else entries.push(e);
		}
		sections.push({ entries });
	} else if (effectiveGroup) {
		const list = providers.find(([p]) => providerGroup(p) === effectiveGroup)?.[1] ?? [];
		sections.push({ entries: list.map((m) => modelEntry(m, false)) });
	}
	const flat = sections.flatMap((s) => s.entries);

	// Reset the keyboard highlight whenever the visible list changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on identity of list
	useEffect(() => {
		setHi(searching ? 0 : -1);
	}, [searching, q, effectiveGroup]);
	useEffect(() => {
		rootRef.current?.querySelector('[data-hi="true"]')?.scrollIntoView?.({ block: "nearest" });
	}, [hi]);

	if (models === null) {
		return (
			<div className="flex items-center gap-2 p-2.5 text-xs text-neutral-400">
				<Loader2 size={13} className="animate-spin text-neutral-400" />
				<span>{t("models.loadingModels")}</span>
			</div>
		);
	}

	const activate = (e: Entry) => {
		if (e.kind === "model") pickModel(toModelKey(e.m.provider, e.m.id));
		else if (e.kind === "extra") onSelect(e.x.value);
		else onSelect(customQuery);
	};

	const stepGroup = (delta: number) => {
		if (groupIds.length === 0 || effectiveGroup === null) return;
		const i = groupIds.indexOf(effectiveGroup);
		setGroup(groupIds[Math.min(groupIds.length - 1, Math.max(0, i + delta))] ?? null);
	};

	const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
		if (ev.nativeEvent.isComposing) return;
		if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
			ev.preventDefault();
			const delta = ev.key === "ArrowDown" ? 1 : -1;
			setHi((h) => Math.min(flat.length - 1, Math.max(0, h + delta)));
		} else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !searching) {
			ev.preventDefault();
			stepGroup(ev.key === "ArrowLeft" ? -1 : 1);
		} else if (ev.key === "Enter") {
			const target = flat[hi >= 0 ? hi : searching ? 0 : -1];
			if (!target) return;
			ev.preventDefault();
			activate(target);
		}
	};

	const check = <Check size={13} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />;

	const renderEntry = (e: Entry, idx: number) => {
		const highlighted = idx === hi;
		const hiProps = { "data-hi": highlighted ? "true" : undefined };
		if (e.kind === "model") {
			const key = toModelKey(e.m.provider, e.m.id);
			const isSelected = selectedKey === key;
			return (
				<div
					key={e.id}
					{...hiProps}
					className={clsx(
						"group flex w-full items-center rounded-[8px] transition-colors",
						isSelected ? ROW_SELECTED : highlighted ? ROW_HI : ROW_IDLE,
					)}
				>
					<button
						type="button"
						title={key}
						onClick={() => pickModel(key)}
						className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-1.5 text-left text-xs"
					>
						<div className="min-w-0 pr-2">
							<div className="break-all font-medium">{e.m.id}</div>
							{e.showProvider && (
								<div className="break-all text-[10px] text-neutral-500">{e.m.provider}</div>
							)}
						</div>
						{isSelected && check}
					</button>
					{e.removable && (
						<button
							type="button"
							title={t("models.removeFromRecent")}
							aria-label={t("models.removeFromRecent")}
							onClick={() => {
								setUndo({ key, prev: recent });
								removeRecent(key);
							}}
							className="mr-1 shrink-0 rounded p-1 text-neutral-500 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100"
						>
							<X size={12} />
						</button>
					)}
				</div>
			);
		}
		if (e.kind === "custom") {
			return (
				<button
					key={e.id}
					type="button"
					{...hiProps}
					onClick={() => onSelect(customQuery)}
					className={clsx(ROW_CLASS, highlighted ? ROW_HI : ROW_IDLE)}
				>
					<span className="min-w-0 break-all">
						{t("models.usePrefix")}<span className="font-mono text-[var(--text)]">{customQuery}</span>
						<span className="text-neutral-500">{t("models.asModelIdSuffix")}</span>
					</span>
					<CornerDownLeft size={12} className="shrink-0 text-neutral-500" />
				</button>
			);
		}
		const isSelected = selectedKey === e.x.value;
		return (
			<button
				key={e.id}
				type="button"
				{...hiProps}
				onClick={() => onSelect(e.x.value)}
				className={clsx(ROW_CLASS, isSelected ? ROW_SELECTED : highlighted ? ROW_HI : ROW_IDLE)}
			>
				<span className="min-w-0">
					{e.x.label}
					{e.resolution && (
						<span className="text-neutral-500"> → {describeResolution(e.resolution)}</span>
					)}
				</span>
				{e.x.hint && !e.resolution ? (
					<span className="ml-1 shrink-0 text-[10px] text-neutral-500">{e.x.hint}</span>
				) : isSelected ? (
					check
				) : null}
			</button>
		);
	};

	const groupButton = (id: GroupId, label: string, count: number) => {
		const active = id === effectiveGroup && !searching;
		return (
			<button
				key={id}
				type="button"
				onClick={() => setGroup(id)}
				className={clsx(
					"flex w-full items-center justify-between gap-1 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
					active
						? "bg-[var(--bg-active-fill)] font-medium text-[var(--text)]"
						: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
				)}
			>
				<span className="min-w-0 break-all" title={label}>
					{label}
				</span>
				<span className="ml-1 flex shrink-0 items-center gap-0.5 text-[10px] text-neutral-600">
					{count}
					<ChevronRight size={10} />
				</span>
			</button>
		);
	};

	let offset = 0;
	const body =
		flat.length === 0 && roleGuides.length === 0 ? (
			<div className="px-3 py-2 text-center text-xs text-neutral-500">
				{searching ? t("models.noMatchingModels") : t("models.noOptions")}
			</div>
		) : (
			sections.map((s, si) => {
				const start = offset;
				offset += s.entries.length;
				return (
					<div key={s.title ?? `s${si}`}>
						{s.title && (
							<div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium text-neutral-500">{s.title}</div>
						)}
						{s.entries.map((e, i) => renderEntry(e, start + i))}
					</div>
				);
			})
		);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: key handling for the whole picker
		<div ref={rootRef} className="flex min-h-0 flex-col outline-none" onKeyDown={onKeyDown} tabIndex={-1}>
			{(caption || refreshing) && (
				<div className="flex shrink-0 items-center justify-between gap-2 px-2.5 pb-1 pt-2 text-[11px] font-medium text-neutral-400">
					<span className="break-all">{caption}</span>
					{refreshing && (
						<Loader2
							size={11}
							className="shrink-0 animate-spin text-neutral-500"
							aria-label={t("models.refreshingModels")}
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
							placeholder={allowCustom ? t("models.searchPlaceholderWithCustom") : t("models.searchPlaceholder")}
							className="w-full bg-transparent outline-none placeholder:text-neutral-500"
						/>
					</div>
				</div>
			)}

			{/* Fixed height so the popover never jumps between groups. */}
			<div className="flex h-72 min-h-0">
				{!searching && (
					<div className="w-36 shrink-0 overflow-y-auto border-r border-[var(--border-divider)] py-0.5">
						{hasCommon && groupButton(GROUP_COMMON, t("models.commonGroup"), plainExtras.length + recentModels.length)}
						{hasRoles && groupButton(GROUP_ROLES, t("models.rolesGroup"), roleExtras.length)}
						{providers.map(([p, list]) => groupButton(providerGroup(p), p, list.length))}
					</div>
				)}
				<div className="min-w-0 flex-1 overflow-y-auto py-0.5">
					{body}
					{roleGuides.map(({ x, roleId }) => (
						<div key={x.value} className={clsx(ROW_CLASS, "gap-1 text-neutral-500")}>
							<button
								type="button"
								onClick={() => openSettingsTarget("models")}
								className="min-w-0 flex-1 text-left hover:text-[var(--accent)]"
							>
								{t("models.roleUnconfigured", { label: x.label })}
							</button>
							<button
								type="button"
								aria-label={t("models.dismiss")}
								title={t("models.dismiss")}
								onClick={() => dismissGuide(roleId)}
								className="shrink-0 rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
							>
								<X size={11} />
							</button>
						</div>
					))}
				</div>
			</div>

			{undo && (
				<div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-divider)] px-2.5 pt-1.5 text-[11px] text-neutral-400">
					<span className="min-w-0 break-all">{t("models.removedFromRecent", { key: undo.key })}</span>
					<button
						type="button"
						onClick={() => {
							setRecent(undo.prev);
							setUndo(null);
						}}
						className="shrink-0 rounded-full border border-[var(--border-divider)] px-2 py-0.5 text-[var(--text)] hover:bg-[var(--bg-hover)]"
					>
						{t("models.undo")}
					</button>
				</div>
			)}
			<div className="shrink-0 border-t border-[var(--border-divider)] px-2.5 pt-1.5 text-[10px] text-neutral-500">
				{t("models.keyboardNavTip")}
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
	/**
	 * Render a separate thinking-level chip beside the model button (like the
	 * composer). Levels come from the selected model's capabilities; the stored
	 * value keeps the `selector:level` format.
	 */
	thinking?: boolean;
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
	thinking = false,
	...menu
}: SelectProps) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const [levelOpen, setLevelOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const placement = `${direction === "up" ? "top" : "bottom"}-${align}` as const;
	const current = parseSelection(menu.currentValue);
	const currentRole = menu.extras?.some((x) => x.value === current.selector)
		? roleIdOf(current.selector)
		: null;
	const selectorIsRole = roleIdOf(current.selector) !== null;
	const { roles, loaded } = useOmpModelRoles(
		currentRole !== null || (thinking && selectorIsRole),
		menu.roles,
	);
	// With the chip the level is shown there, not appended to the model label.
	const labelLevel = thinking ? null : current.level;
	let displayLabel = label;
	if (currentRole && loaded) {
		displayLabel = `${RESOLVABLE_ROLES[currentRole]} → ${describeResolution(
			resolveRole(roles, currentRole, menu.models),
			labelLevel,
		)}`;
	} else if (currentRole && labelLevel) {
		displayLabel = `${RESOLVABLE_ROLES[currentRole]} · ${labelLevel}`;
	} else if (labelLevel) {
		const name = findCatalogModel(menu.models, current.selector)?.id ?? current.selector;
		displayLabel = `${name} · ${labelLevel}`;
	}
	const levels = thinking
		? thinkingLevelsFor(current.selector, menu.models, roles, current.level)
		: [];
	const thinkingModel = thinking ? thinkingModelFor(current.selector, menu.models, roles) : null;
	// Hidden only while the model is unresolved (unknown selector / role still loading).
	const showLevel = thinkingModel !== null && (!selectorIsRole || loaded);
	const isOpen = open && !disabled;
	useEffect(() => {
		if (disabled) {
			setOpen(false);
			setLevelOpen(false);
		}
	}, [disabled]);

	const select = (
		<div className="relative">
			<button
				ref={buttonRef}
				type="button"
				disabled={disabled}
				onClick={() => {
					if (!disabled) setOpen((v) => !v);
				}}
				title={displayLabel || t("models.selectModel")}
				className={buttonClass}
			>
				<span className="truncate">{displayLabel}</span>
				{icon && <ChevronDown size={11} className="shrink-0 text-neutral-500" />}
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
					onSelect={(v) => {
						if (disabled) return;
						menu.onSelect(
							thinking && menu.models
								? carryLevel(v, current.level, menu.models, roles)
								: v,
						);
						setOpen(false);
						buttonRef.current?.focus();
					}}
				/>
			</FloatingLayer>
		</div>
	);
	if (!thinking) return select;
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			{select}
			{showLevel && (
				<ThinkingLevelPicker
					variant="pill"
					levels={levels}
					reasoning={thinkingModel?.reasoning}
					value={current.level ?? FOLLOW_LEVEL}
					open={levelOpen && !disabled}
					onOpenChange={setLevelOpen}
					onSelect={(level) => {
						if (disabled) return;
						menu.onSelect(applyThinkingLevel(current.selector, level));
					}}
				/>
			)}
		</div>
	);
}
