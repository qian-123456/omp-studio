/**
 * [D] Small pieces shared by the 批量替换模型 dialog steps: buttons, the thinking
 * level select, the per-kind target picker and the row badges.
 */
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { ModelMenuContent } from "../../../components/ModelSelect";
import { NativeSelect } from "../../../components/NativeSelect";
import type { ModelKindEntry } from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { type KindGroup, kindGroup } from "./kinds";
import { useT } from "../../../stores/language";

export const BTN_PRIMARY =
	"shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50";

export const BTN_GHOST =
	"shrink-0 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 disabled:opacity-50";

export const CHECKBOX_CLASS = "h-3.5 w-3.5 shrink-0";

/**
 * Level picker: 模型默认 (no suffix) first, then exactly the levels the target model
 * supports. Renders nothing when the target has no thinking levels.
 */
export function LevelSelect({
	value,
	levels,
	onChange,
	disabled,
	ariaLabel,
	containerClassName,
}: {
	/** null = 模型默认. */
	value: string | null;
	/** Levels of the target model (`levelsForSelector`). */
	levels: readonly string[];
	onChange: (level: string | null) => void;
	disabled?: boolean;
	ariaLabel: string;
	containerClassName?: string;
}) {
	const { t } = useT();
	if (levels.length === 0) return null;
	return (
		<NativeSelect
			aria-label={ariaLabel}
			value={value ?? ""}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
			containerClassName={containerClassName}
			className="text-[11px]"
		>
			<option value="">{t("modelReplace.modelDefault")}</option>
			{levels.map((level) => (
				<option key={level} value={level}>
					{level === "off" ? t("modelReplace.offThinking") : level}
				</option>
			))}
		</NativeSelect>
	);
}

/** Tabs of the target picker; models that are in no tab group (`missing`) never appear. */
export const TARGET_TABS: readonly KindGroup[] = ["chat", "search", "judge", "other"];

const TARGET_TAB_KEYS: Record<KindGroup, string> = {
	missing: "modelReplace.kindGroup.chat",
	chat: "modelReplace.kindGroup.chat",
	search: "modelReplace.kindGroup.search",
	judge: "modelReplace.kindGroup.judge",
	other: "modelReplace.tabOther",
};

/** The tab a source group starts on: `missing` (not in the catalogue) means chat. */
export function tabOfGroup(group: KindGroup): KindGroup {
	return group === "missing" ? "chat" : group;
}

const PICKER_BUTTON =
	"flex min-h-7 w-full items-center justify-between gap-2 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-left text-xs text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50";

/**
 * Catalogue-only target picker over the kind catalogue: kind tabs (unless
 * `lockGroup` pins one), a search box and a list. The label comes first and the
 * chevron sits at the trailing edge.
 */
export function TargetPicker({
	value,
	entries,
	loading,
	error,
	initialGroup,
	lockGroup,
	onSelect,
	disabled,
	buttonClass,
	caption,
}: {
	value: string;
	entries: ModelKindEntry[] | null;
	loading: boolean;
	error: string | null;
	/** Tab shown when the popover opens. */
	initialGroup: KindGroup;
	/** Only list this group and hide the tabs (per-row overrides stay on the target's kind). */
	lockGroup?: KindGroup;
	onSelect: (selector: string) => void;
	disabled?: boolean;
	buttonClass?: string;
	caption?: string;
}) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<KindGroup>(tabOfGroup(lockGroup ?? initialGroup));
	const buttonRef = useRef<HTMLButtonElement>(null);
	const activeTab = lockGroup ? tabOfGroup(lockGroup) : tab;

	// The app's grouped two-pane picker (providers left, models right) over the
	// active kind's catalogue rows; never a flat list of every model.
	const models = useMemo<ModelOption[] | null>(() => {
		if (entries === null) return null;
		return entries
			.filter((entry) => tabOfGroup(kindGroup(entry.kind)) === activeTab)
			.map((entry) => {
				const prefix = `${entry.provider}/`;
				const slash = entry.selector.indexOf("/");
				return entry.selector.startsWith(prefix)
					? { provider: entry.provider, id: entry.selector.slice(prefix.length), name: entry.name ?? entry.selector }
					: {
							provider: entry.selector.slice(0, slash),
							id: entry.selector.slice(slash + 1),
							name: entry.name ?? entry.selector,
						};
			})
			.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
	}, [entries, activeTab]);

	const close = () => {
		setOpen(false);
		buttonRef.current?.focus();
	};

	return (
		<div className="relative min-w-0">
			<button
				ref={buttonRef}
				type="button"
				disabled={disabled}
				title={value || t("modelReplace.selectTargetModel")}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => {
					if (disabled) return;
					if (!open) setTab(tabOfGroup(lockGroup ?? initialGroup));
					setOpen((v) => !v);
				}}
				className={buttonClass ?? PICKER_BUTTON}
			>
				<span className={clsx("min-w-0 flex-1 break-all", value ? "font-mono" : "text-neutral-400")}>
					{value || t("modelReplace.selectTargetModel")}
				</span>
				<ChevronDown size={11} className="shrink-0 text-neutral-500" />
			</button>
			<FloatingLayer
				anchor={open && !disabled ? buttonRef.current : null}
				placement="bottom-start"
				offset={4}
				layer="popover"
				ignoreRefs={[buttonRef]}
				onDismiss={close}
				className="flex w-[560px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1.5"
			>
				{caption && <div className="px-3 pb-1 text-[10px] text-neutral-500">{caption}</div>}
				{!lockGroup && (
					<div className="flex gap-1 px-2 pb-1.5" role="tablist">
						{TARGET_TABS.map((group) => (
							<button
								key={group}
								type="button"
								role="tab"
								aria-selected={activeTab === group}
								onClick={() => setTab(group)}
								className={clsx(
									"rounded-full px-2 py-0.5 text-[11px] transition-all",
									activeTab === group
										? "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"
										: "bg-[var(--well-bg)] text-neutral-400 hover:text-neutral-200",
								)}
							>
								{t(TARGET_TAB_KEYS[group])}
							</button>
						))}
					</div>
				)}
				{models === null ? (
					<div className="px-3 py-3 text-[11px]">
						{error !== null && !loading ? (
							<span className="break-all text-rose-300">{t("modelReplace.catalogError", { error })}</span>
						) : (
							<span className="text-neutral-500">{t("modelReplace.loadingCatalog")}</span>
						)}
					</div>
				) : models.length === 0 ? (
					<div className="px-3 py-3 text-[11px] text-neutral-500">{t("modelReplace.noModelsInGroup")}</div>
				) : (
					<ModelMenuContent
						key={activeTab}
						models={models}
						currentValue={value}
						closeOnSelect
						onSelect={(selector) => {
							onSelect(selector);
							close();
						}}
					/>
				)}
			</FloatingLayer>
		</div>
	);
}

export function Chip({
	tone = "neutral",
	title,
	children,
}: {
	tone?: "neutral" | "warn" | "good" | "info";
	title?: string;
	children: ReactNode;
}) {
	return (
		<span
			title={title}
			className={clsx(
				"max-w-full shrink-0 break-all rounded-full px-1.5 py-px text-[10px] leading-4",
				tone === "warn" && "bg-[color-mix(in_srgb,var(--status-warning)_15%,transparent)] text-[var(--status-warning)]",
				tone === "good" && "bg-emerald-500/15 text-emerald-300",
				tone === "info" && "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]",
				tone === "neutral" && "bg-[var(--bg-active-fill)] text-neutral-400",
			)}
		>
			{children}
		</span>
	);
}
