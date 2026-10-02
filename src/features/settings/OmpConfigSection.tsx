import clsx from "clsx";
import { AlertTriangle, Braces, ChevronRight, FolderGit2, KeyRound, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { confirmDialog } from "../../lib/dialogs";
import { ompConfigReset, ompConfigSet, ompProjectConfigRead } from "../../lib/ipc";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import { Switch } from "./Switch";
import { useOmpConfigStore } from "./ompConfigStore";
import {
	OMP_CONFIG_META,
	ompConfigDescription,
	ompConfigGroup,
	ompConfigOptionLabel,
	ompConfigOptions,
	ompConfigTitle,
} from "./ompConfigMeta";
import { defaultState, defaultText, isStringList, lookupDotPath, parseProjectConfig, toStringList } from "./ompConfigEdit";
import { groupByDesktopCategory, isDesktopRelevant } from "./ompDesktopCategories";
import { JsonEditor, RecordEditor, SecretInput, StringListEditor } from "./ompValueEditors";
import { CommitInput, SaveIndicator, useSaveStatus } from "./ui";
import { useSettingsProjectCwd } from "./useAppSettings";
import { AutoCompactionCard } from "./AutoCompactionCard";

/** Project-layer value for a key from `<cwd>/.omp/config.yml`. */
interface ProjectOverride {
	path: string;
	value: unknown;
}

/** Sentinel select value for the "type a custom value" escape hatch. */
const CUSTOM_VALUE = "__custom__";

function displayValue(value: unknown): string {
	if (value === null || value === undefined) return "未设置";
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}

/** Readable label for one option: curated Chinese, with the raw value appended when it differs. */
function optionText(key: string, o: { value: string; label?: string }): string {
	const label = ompConfigOptionLabel(key, o);
	if (label === o.value || (o.label !== undefined && label === o.label)) return label;
	return `${label}（${o.value}）`;
}

const SECRET_KEY = /(?:token|password|apikey|secret)$/i;

const CHIP = "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-medium";

/** Parent-child dependencies: when parent is off, children are indented and disabled. */
const PARENT_CHILD_MAP: Record<string, { parent: string; reason: string }> = {
	// compaction.enabled is master switch
	"compaction.asyncEnabled": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.dropUseless": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.experimentalContextManagement": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.handoffSaveToDisk": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.idleEnabled": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.methodOrder": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.midTurnEnabled": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.remoteStreamingV2Enabled": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.supersedeReads": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.thresholdPercent": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	"compaction.thresholdTokens": { parent: "compaction.enabled", reason: "「自动压缩」总开关已关闭，此设置暂不生效" },
	// compaction.idleEnabled sub-hierarchy
	"compaction.idleThresholdTokens": { parent: "compaction.idleEnabled", reason: "开启「空闲压缩」后生效" },
	"compaction.idleTimeoutSeconds": { parent: "compaction.idleEnabled", reason: "开启「空闲压缩」后生效" },
	// bash.autoBackground hierarchy
	"bash.autoBackground.thresholdMs": { parent: "bash.autoBackground.enabled", reason: "开启「自动后台运行」后生效" },
	// autolearn hierarchy
	"autolearn.autoContinue": { parent: "autolearn.enabled", reason: "开启「自主学习」后生效" },
	// contextPromotion hierarchy
	"contextPromotion.maxPromotions": { parent: "contextPromotion.enabled", reason: "开启「上下文提升」后生效" },
	"contextPromotion.promotionStrategy": { parent: "contextPromotion.enabled", reason: "开启「上下文提升」后生效" },
};

/** Macro-group resolver to avoid 25+ tiny micro-pills in large categories like tools & context. */
function ompCategorySubGroup(category: string, key: string): string {
	if (category === "tools") {
		if (key.startsWith("tools.")) return "可用工具与审批";
		if (
			key.startsWith("bash.") ||
			key.startsWith("eval.") ||
			key.startsWith("python.") ||
			key.startsWith("lsp.") ||
			key.startsWith("launch.") ||
			key.startsWith("debug.")
		) {
			return "终端与代码运行";
		}
		if (
			key.startsWith("web_search.") ||
			key.startsWith("browser.") ||
			key.startsWith("fetch.") ||
			key.startsWith("find.")
		) {
			return "搜索与网络工具";
		}
		if (
			key.startsWith("images.") ||
			key.startsWith("generate_image.") ||
			key.startsWith("computer.") ||
			key.startsWith("speechgen.") ||
			key.startsWith("tts.")
		) {
			return "视觉与多模态";
		}
		if (
			key.startsWith("edit.") ||
			key.startsWith("read.") ||
			key.startsWith("astEdit.") ||
			key.startsWith("astGrep.")
		) {
			return "文件与代码编辑";
		}
		if (
			key.startsWith("mcp.") ||
			key.startsWith("skills.") ||
			key.startsWith("commands.")
		) {
			return "扩展与插件配置";
		}
		return "其他工具设置";
	}
	if (category === "context") {
		if (key.startsWith("compaction.")) return "上下文压缩";
		if (key.startsWith("memory.") || key.startsWith("mnemopi.") || key.startsWith("hindsight.") || key.startsWith("memories.")) {
			return "记忆系统";
		}
		if (key.startsWith("autolearn.")) return "自主学习";
		if (key.startsWith("context.") || key.startsWith("prompt.") || key.startsWith("input.")) {
			return "上下文控制";
		}
	}
	return ompConfigGroup(key) ?? "其他";
}

/** Group display order for specific categories (prioritize core tools & compaction). */
const GROUP_ORDER: Record<string, string[]> = {
	context: ["上下文压缩", "上下文控制", "记忆系统", "自主学习", "其他"],
	tools: [
		"可用工具与审批",
		"终端与代码运行",
		"搜索与网络工具",
		"文件与代码编辑",
		"视觉与多模态",
		"扩展与插件配置",
		"其他工具设置",
	],
};

/**
 * One config entry, laid out like a TUI /settings row: title + state badges,
 * one-line description, raw key; the control edits in place and autosaves.
 * Arrays/records get structured editors under the text with a JSON escape hatch.
 */
function ConfigRow({
	entry,
	override,
	onChanged,
	hierarchyDisabled = false,
	hierarchyReason,
}: {
	entry: OmpConfigEntry;
	override: ProjectOverride | null;
	onChanged: () => void;
	hierarchyDisabled?: boolean;
	hierarchyReason?: string;
}) {
	const save = useSaveStatus();
	const [busy, setBusy] = useState(false);
	const [jsonMode, setJsonMode] = useState(false);
	const [custom, setCustom] = useState(false);
	const [expanded, setExpanded] = useState(false);

	const persist = async (raw: string) => {
		setBusy(true);
		try {
			const ok = await save.run(() => ompConfigSet(entry.key, raw));
			if (ok) onChanged();
			return ok;
		} finally {
			setBusy(false);
		}
	};
	const persistJson = (value: unknown) => persist(JSON.stringify(value));

	const title = ompConfigTitle(entry.key);
	const description = ompConfigDescription(entry.key, entry.description).trim();
	const state = defaultState(entry.key, entry.value, entry.redacted);
	const defText = defaultText(entry.key);
	const isUnset = entry.value === null || entry.value === undefined;
	// Unknown defaults: only offer reset when something is actually set.
	const canReset = state === "modified" || (state === "unknown" && !isUnset);

	const reset = async () => {
		const target = defText ? `默认值「${defText}」` : "OMP 默认值";
		if (!(await confirmDialog(`将「${title}」恢复为${target}？`, { danger: true, okLabel: "恢复默认" }))) return;
		setBusy(true);
		try {
			const ok = await save.run(() => ompConfigReset(entry.key));
			if (ok) {
				setJsonMode(false);
				setCustom(false);
				onChanged();
			}
		} finally {
			setBusy(false);
		}
	};

	const isStructured = entry.valueType === "array" || entry.valueType === "record";
	// omp redacts stored credentials; unset ones arrive as plain empty strings, so
	// credential-looking keys stay write-only too.
	const secret = entry.redacted || SECRET_KEY.test(entry.key);
	const strict = (OMP_CONFIG_META[entry.key]?.values?.length ?? 0) > 0 || entry.valueType === "enum";
	const options = isStructured || secret ? null : ompConfigOptions(entry.key);
	const current = isUnset ? "" : typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
	const inOptions = options?.some((o) => o.value === current) ?? false;

	let control: React.ReactNode = null;
	if (secret && !isStructured) {
		control = <SecretInput isSet={entry.redacted || !isUnset} busy={busy} label={title} onSave={persist} />;
	} else if (entry.valueType === "boolean") {
		control = (
			<Switch checked={entry.value === true} disabled={busy} onChange={(v) => void persist(v ? "true" : "false")} />
		);
	} else if (options && strict && options.length <= 4 && options.every((o) => optionText(entry.key, o).length <= 10)) {
		control = (
			<Segmented
				size="sm"
				aria-label={title}
				disabled={busy}
				value={current}
				options={options.map((o) => ({ value: o.value, label: optionText(entry.key, o), title: o.description }))}
				onChange={(v) => void persist(v)}
			/>
		);
	} else if (options) {
		const showCustom = !strict && (custom || (!inOptions && !isUnset));
		control = (
			<div className="flex items-center gap-1.5">
				<NativeSelect
					aria-label={title}
					value={showCustom ? CUSTOM_VALUE : inOptions ? current : ""}
					disabled={busy}
					onChange={(e) => {
						if (e.target.value === CUSTOM_VALUE) {
							setCustom(true);
						} else if (e.target.value) {
							setCustom(false);
							void persist(e.target.value);
						}
					}}
					containerClassName="w-48"
					className="text-[11px]"
				>
					{!inOptions && !showCustom && <option value="">{isUnset ? "未设置" : current}</option>}
					{options.map((o) => (
						<option key={o.value} value={o.value} title={o.description}>
							{optionText(entry.key, o)}
						</option>
					))}
					{!strict && <option value={CUSTOM_VALUE}>自定义…</option>}
				</NativeSelect>
				{showCustom && (
					<CommitInput
						className="w-28"
						type={entry.valueType === "number" ? "number" : "text"}
						mono
						value={current}
						aria-label={`${title}（自定义）`}
						validate={(v) => (entry.valueType === "number" && !Number.isFinite(Number(v)) ? "请输入数字" : null)}
						onCommit={async (v) => {
							if (!(await persist(v))) throw new Error(save.error ?? "保存失败");
						}}
					/>
				)}
			</div>
		);
	} else if (entry.valueType === "number") {
		control = (
			<CommitInput
				className="w-36"
				type="number"
				value={current}
				placeholder={defText && state !== "default" ? `默认 ${defText}` : undefined}
				aria-label={title}
				validate={(v) => (v === "" || Number.isFinite(Number(v)) ? null : "请输入数字")}
				onCommit={(v) => (v === "" ? ompConfigReset(entry.key).then(onChanged) : ompConfigSet(entry.key, v).then(onChanged))}
			/>
		);
	} else if (!isStructured) {
		control = (
			<CommitInput
				className="w-64"
				mono
				value={current}
				placeholder={defText && defText !== "未设置" ? `默认 ${defText}` : "未设置"}
				aria-label={title}
				onCommit={(v) => ompConfigSet(entry.key, v).then(onChanged)}
			/>
		);
	}

	const stringList = entry.valueType === "array" && isStringList(entry.value);

	return (
		<div
			data-omp-key={entry.key}
			data-omp-row=""
			data-omp-type={entry.valueType}
			tabIndex={hierarchyDisabled ? undefined : -1}
			className={clsx(
				"px-3.5 py-2.5 outline-none transition-colors",
				hierarchyDisabled
					? "pointer-events-none opacity-50 pl-6 border-l-2 border-neutral-700/50"
					: "focus-visible:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span className="text-xs font-semibold tracking-[-0.01em] text-neutral-100" title={entry.key}>{title}</span>
						{state === "modified" && (
							<span className={clsx(CHIP, "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)] font-medium")} title={defText ? `默认值：${defText}` : undefined}>
								已修改
							</span>
						)}
						{state === "default" && <span className={clsx(CHIP, "bg-neutral-700/40 text-neutral-500")}>默认</span>}
						{secret && (entry.redacted || !isUnset) && (
							<span className={clsx(CHIP, "bg-emerald-500/15 text-emerald-300")}>已设置</span>
						)}
						{secret && (
							<span className={clsx(CHIP, "bg-amber-500/15 text-amber-300")} title="凭据只写不读：界面不会显示已保存的内容">
								<KeyRound className="h-2.5 w-2.5" />
								凭据
							</span>
						)}
						{override && (
							<span
								className={clsx(CHIP, "bg-violet-500/15 text-violet-300")}
								title={`当前项目的 ${override.path} 设置了：${displayValue(override.value)}\n在这个项目里会优先使用该值，这里的全局修改不会生效。`}
							>
								<FolderGit2 className="h-2.5 w-2.5" />
								本项目已覆盖
							</span>
						)}
						<SaveIndicator status={save.status} error={save.error} />
						{canReset && (
							<button
								type="button"
								disabled={busy}
								onClick={() => void reset()}
								title={defText ? `恢复为默认值：${defText}` : "恢复为 OMP 默认值"}
								className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-neutral-500 transition-colors hover:text-amber-300 disabled:opacity-50"
							>
								<RotateCcw className="h-2.5 w-2.5" />
								恢复默认
							</button>
						)}
					</div>
					{description && (
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							title={expanded ? undefined : description}
							className={clsx(
								"mt-0.5 block w-full cursor-default text-left text-[11px] leading-[1.45] text-neutral-400",
								!expanded && "line-clamp-1",
							)}
						>
							{description}
						</button>
					)}
					{hierarchyDisabled && hierarchyReason && (
						<div className="mt-1 text-[11px] text-amber-400/70">
							{hierarchyReason}
						</div>
					)}
					{save.status === "error" && save.error && (
						<div className="mt-1 flex items-start gap-1 text-[11px] text-rose-300">
							<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
							<span className="break-all">{save.error}</span>
						</div>
					)}
				</div>
				{control && <div className="flex shrink-0 items-center pt-0.5">{control}</div>}
			</div>

			{isStructured && (
				<div className="mt-2">
					{entry.redacted ? (
						<SecretJson entry={entry} busy={busy} onSave={persistJson} />
					) : jsonMode ? (
						<JsonEditor
							value={entry.value}
							valueType={entry.valueType}
							busy={busy}
							onSave={persistJson}
							onClose={() => setJsonMode(false)}
						/>
					) : (
						<>
							{entry.valueType === "array" && stringList ? (
								<StringListEditor value={toStringList(entry.value)} busy={busy} onSave={persistJson} />
							) : entry.valueType === "record" ? (
								<RecordEditor value={entry.value} busy={busy} onSave={persistJson} />
							) : (
								<pre className="max-h-40 overflow-auto rounded-lg bg-[var(--well-bg)] p-2 font-mono text-[11px] text-neutral-300 hairline">
									{JSON.stringify(entry.value, null, 2)}
								</pre>
							)}
							<button
								type="button"
								onClick={() => setJsonMode(true)}
								className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-200"
								title="直接编辑原始 JSON（高级）"
							>
								<Braces className="h-3 w-3" />
								编辑 JSON
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}

/** Write-only JSON input for redacted structured credentials (never pre-filled). */
function SecretJson({ entry, busy, onSave }: { entry: OmpConfigEntry; busy: boolean; onSave: (v: unknown) => Promise<boolean> }) {
	const [open, setOpen] = useState(false);
	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-200"
			>
				<KeyRound className="h-3 w-3" />
				已设置的内容不会显示 · 点击整体替换（JSON）
			</button>
		);
	}
	return <JsonEditor value={entry.valueType === "array" ? [] : {}} valueType={entry.valueType} busy={busy} onSave={onSave} onClose={() => setOpen(false)} />;
}

/** Row-level keyboard: ↑/↓ move between rows, Space toggles switches, Enter focuses the control. */
function handleRowKeys(e: React.KeyboardEvent<HTMLDivElement>) {
	const target = e.target as HTMLElement;
	const row = target.closest<HTMLElement>("[data-omp-row]");
	if (!row) return;
	const inField = target !== row && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
	if (inField) return;
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-omp-row]")];
		const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
		if (next) {
			e.preventDefault();
			next.focus();
			next.scrollIntoView({ block: "nearest" });
		}
		return;
	}
	if (target !== row) return;
	if (e.key === " " && row.dataset.ompType === "boolean") {
		e.preventDefault();
		row.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
	} else if (e.key === "Enter") {
		const field = row.querySelector<HTMLElement>("input, select, textarea, [role=radio][aria-checked=true], [role=switch]");
		if (field) {
			e.preventDefault();
			field.focus();
		}
	}
}

/**
 * Settings panel bridging to OMP's own config system (`omp config list/set/reset`).
 * The active desktop category (model/thinking/…/advanced) is selected from the
 * settings left nav (controlled from outside); TUI-only keys never reach this
 * panel. Entries are sub-grouped by their schema group (Tools, Memory, …).
 */
export function OmpConfigSection({
	activeTab,
	onTabChange,
	activeGroupName,
	onGroupChange,
	query,
	seedQuery,
	keyPrefix,
	keysOnly,
	title,
	hint,
}: {
	activeTab: string;
	onTabChange: (tab: string) => void;
	/** Schema sub-group (Theme / Composer / …); controlled when defined — pass
	 * `null` to force "all groups". Omit to let the panel manage it locally. */
	activeGroupName?: string | null;
	onGroupChange?: (group: string | null) => void;
	/** External search query from the nav search box. */
	query?: string;
	seedQuery?: string;
	/** Restrict the listing to keys with this dotted prefix (e.g. "mcp."). */
	keyPrefix?: string;
	/** Restrict the listing to exactly these keys. */
	keysOnly?: readonly string[];
	/** Header overrides for embedded/prefix-filtered listings. */
	title?: string;
	hint?: string;
}) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);

	const [localGroupName, setLocalGroupName] = useState<string | null>(null);
	const effectiveGroupName =
		activeGroupName !== undefined ? activeGroupName : localGroupName;
	const setGroupName = onGroupChange ?? setLocalGroupName;

	const [filter, setFilter] = useState("");
	const [listRef, setListRef] = useState<HTMLDivElement | null>(null);
	const terms = useMemo(
		() => [(query ?? seedQuery ?? "").trim().toLowerCase(), filter.trim().toLowerCase()].filter(Boolean),
		[query, seedQuery, filter],
	);
	const matches = useCallback(
		(e: OmpConfigEntry) =>
			terms.every(
				(t) =>
					e.key.toLowerCase().includes(t) ||
					ompConfigTitle(e.key).toLowerCase().includes(t) ||
					ompConfigDescription(e.key, e.description).toLowerCase().includes(t) ||
					(ompConfigGroup(e.key) ?? "").toLowerCase().includes(t),
			),
		[terms],
	);

	useEffect(() => {
		setLocalGroupName(null);
		setFilter("");
	}, [activeTab]);

	useEffect(() => {
		void load();
	}, [load]);

	// Project layer: `<cwd>/.omp/config.yml` wins over the global config in that project.
	const cwd = useSettingsProjectCwd();
	const [project, setProject] = useState<{ path: string; data: Record<string, unknown> } | null>(null);
	const [projectTick, setProjectTick] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: projectTick re-reads after edits
	useEffect(() => {
		if (!cwd) {
			setProject(null);
			return;
		}
		let alive = true;
		ompProjectConfigRead(cwd)
			.then((f) => {
				if (alive) setProject(f.exists ? { path: f.path, data: parseProjectConfig(f.content) } : null);
			})
			.catch(() => {
				if (alive) setProject(null);
			});
		return () => {
			alive = false;
		};
	}, [cwd, projectTick]);
	const overrideFor = (key: string): ProjectOverride | null => {
		if (!project) return null;
		const hit = lookupDotPath(project.data, key);
		return hit.found ? { path: project.path, value: hit.value } : null;
	};
	const hiddenCount = useMemo(() => entries.filter((e) => !isDesktopRelevant(e.key)).length, [entries]);

	const allGroups = useMemo(
		() =>
			groupByDesktopCategory(
				keyPrefix
					? entries.filter((e) => e.key.startsWith(keyPrefix))
					: keysOnly
						? entries.filter((e) => keysOnly.includes(e.key))
						: entries,
			).map((g) => ({
				id: g.category.id,
				label: g.category.label,
				hint: g.category.hint,
				entries: g.entries,
			})),
		[entries, keyPrefix, keysOnly],
	);
	const activeGroup =
		allGroups.find((g) => g.id === activeTab) ?? allGroups[0] ?? null;

	const groupCounts = useMemo(() => {
		const map = new Map<string, number>();
		for (const e of activeGroup?.entries ?? []) {
			const g = ompCategorySubGroup(activeTab, e.key);
			map.set(g, (map.get(g) ?? 0) + 1);
		}
		const order = GROUP_ORDER[activeTab];
		if (order) {
			const sorted: { name: string; count: number }[] = [];
			for (const name of order) {
				const count = map.get(name);
				if (count) {
					sorted.push({ name, count });
					map.delete(name);
				}
			}
			for (const [name, count] of map.entries()) {
				sorted.push({ name, count });
			}
			return sorted;
		}
		return [...map.entries()].map(([name, count]) => ({ name, count }));
	}, [activeGroup, activeTab]);

	// Recover from a stale group (disappeared after omp upgrade).
	useEffect(() => {
		if (effectiveGroupName && !groupCounts.some((g) => g.name === effectiveGroupName)) {
			setGroupName(null);
		}
	}, [effectiveGroupName, groupCounts, setGroupName]);

	// Recover from a stale selection (tab disappeared after omp upgrade).
	useEffect(() => {
		if (allGroups.length > 0 && !allGroups.some((g) => g.id === activeTab)) {
			onTabChange(allGroups[0].id);
		}
	}, [allGroups, activeTab, onTabChange]);

	const rows = useMemo(() => {
		const base = effectiveGroupName
			? (activeGroup?.entries ?? []).filter(
					(e) => ompCategorySubGroup(activeTab, e.key) === effectiveGroupName,
				)
			: (activeGroup?.entries ?? []);
		return terms.length === 0 ? base : base.filter(matches);
	}, [activeGroup, activeTab, effectiveGroupName, terms, matches]);

	// Group entries by macro-group or schema group; ordering applied per GROUP_ORDER.
	const grouped = useMemo(() => {
		const named = new Map<string, OmpConfigEntry[]>();
		const other: OmpConfigEntry[] = [];
		for (const entry of rows) {
			const group = ompCategorySubGroup(activeTab, entry.key);
			if (group && group !== "其他" && group !== "其他工具设置") {
				const list = named.get(group);
				if (list) {
					list.push(entry);
				} else {
					named.set(group, [entry]);
				}
			} else {
				other.push(entry);
			}
		}
		const order = GROUP_ORDER[activeTab];
		let result: [string, OmpConfigEntry[]][];
		if (order) {
			result = [];
			for (const groupName of order) {
				const list = named.get(groupName);
				if (list) {
					result.push([groupName, list]);
					named.delete(groupName);
				}
			}
			result.push(...named.entries());
		} else {
			result = [...named.entries()];
		}
		if (other.length > 0) result.push([activeTab === "tools" ? "其他工具设置" : "其他", other]);
		return result;
	}, [rows, activeTab]);

	const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
	const toggleGroupCollapse = (groupName: string) => {
		setCollapsedGroups((prev) => {
			const next = new Set(prev);
			if (next.has(groupName)) next.delete(groupName);
			else next.add(groupName);
			return next;
		});
	};

	// Calculate parent values for hierarchy checking
	const parentValues = useMemo(() => {
		const values: Record<string, boolean> = {};
		for (const entry of entries) {
			if (entry.valueType === "boolean") {
				values[entry.key] = entry.value === true;
			}
		}
		return values;
	}, [entries]);

	// When the current tab has no matches, point at other tabs that do.
	const suggestions = useMemo(() => {
		if (terms.length === 0) return [];
		return allGroups
			.filter((g) => g.id !== activeGroup?.id)
			.map((g) => ({ id: g.id, label: g.label, count: g.entries.filter(matches).length }))
			.filter((s) => s.count > 0);
	}, [allGroups, activeGroup, terms, matches]);
	const handleChanged = () => {
		// Re-list so edited values (and switches elsewhere) stay in sync with omp.
		void load(true);
		setProjectTick((t) => t + 1);
	};

	if (loading && !loaded) {
		return (
			<div className="flex items-center gap-2 rounded-xl hairline bg-[var(--bg-panel)] p-6 text-xs text-neutral-500 shadow-apple-card">
				<RefreshCw className="h-4 w-4 animate-spin" />
				<span>正在读取 OMP 配置项...</span>
			</div>
		);
	}

	if (error && !loaded) {
		return (
			<div className="rounded-xl hairline bg-[var(--bg-panel)] p-6 text-center shadow-apple-card">
				<AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500/70" />
				<div className="text-xs font-medium text-neutral-300">
					无法读取 OMP 配置
				</div>
				<div className="mx-auto mt-1 max-w-md break-all text-[11px] text-neutral-500">
					{error}
				</div>
				<div className="mx-auto mt-2 max-w-md text-[11px] text-neutral-500">
					请确认本机已安装 omp，并在 系统设置 → 高级 → OMP 命令行程序
					中检查二进制路径是否正确
				</div>
				<button
					type="button"
					onClick={() => void load(true)}
					className="mt-3 inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
				>
					<RefreshCw className="h-3.5 w-3.5" />
					<span>重试</span>
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<div className="flex items-baseline gap-1.5">
						<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
							{title ?? activeGroup?.label}
						</h2>
						{effectiveGroupName && (
							<>
								<span className="text-xs text-neutral-600">›</span>
								<span className="text-xs text-neutral-400">{effectiveGroupName}</span>
							</>
						)}
					</div>
					{(hint ?? activeGroup?.hint) && (
						<p className="mt-0.5 text-xs text-neutral-400">
							{hint ?? activeGroup?.hint}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-[11px] text-neutral-500">
						{rows.length}/{activeGroup?.entries.length ?? 0} 项
					</span>
					<button
						type="button"
						onClick={handleChanged}
						title="重新读取 OMP 配置"
						className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{groupCounts.length > 1 && (
				<div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
					<button
						type="button"
						onClick={() => setGroupName(null)}
						className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
							effectiveGroupName === null
								? "bg-[var(--accent)] text-[var(--bg)] font-medium shadow-sm"
								: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
						}`}
					>
						全部
					</button>
					{groupCounts.map((g) => (
						<button
							key={g.name}
							type="button"
							onClick={() => setGroupName(g.name)}
							className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
								effectiveGroupName === g.name
									? "bg-[var(--accent)] text-[var(--bg)] font-medium shadow-sm"
									: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
							}`}
						>
							{g.name}
							<span className="ml-1 text-[10px] opacity-70">{g.count}</span>
						</button>
					))}
				</div>
			)}

			<div className="relative">
				<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
				<input
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape" && filter) {
							e.stopPropagation();
							setFilter("");
						} else if (e.key === "ArrowDown") {
							const first = listRef?.querySelector<HTMLElement>("[data-omp-row]");
							if (first) {
								e.preventDefault();
								first.focus();
							}
						}
					}}
					spellCheck={false}
					placeholder={`筛选本页 ${activeGroup?.entries.length ?? 0} 项（名称、说明或键名）· ↓ 进入列表，↑↓ 切换，空格开关，回车编辑`}
					className="w-full rounded-lg hairline bg-[var(--well-bg)] py-1.5 pl-8 pr-3 text-xs text-neutral-200 placeholder:text-neutral-500 transition-all focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
				/>
			</div>

			{project && (
				<p className="flex items-start gap-1.5 text-[11px] text-neutral-500">
					<FolderGit2 className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" />
					<span>
						这里修改的是全局设置。当前项目有自己的配置文件（<span className="font-mono">{project.path}</span>），
						标有「本项目已覆盖」的项在该项目中以项目文件为准。
					</span>
				</p>
			)}

			{rows.length === 0 ? (
				<div className="rounded-xl hairline bg-[var(--bg-panel)] p-6 text-center text-xs text-neutral-500 shadow-apple-card">
					<div>没有匹配的配置项</div>
					{suggestions.length > 0 && (
						<div className="mt-3 space-y-2">
							<div className="text-neutral-400">以下分类有匹配，点击切换：</div>
							<div className="flex flex-wrap justify-center gap-1.5">
								{suggestions.map((s) => (
									<button
										key={s.id}
										type="button"
										onClick={() => onTabChange(s.id)}
										className="rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
									>
										{s.label}
										<span className="ml-1.5 text-[10px] text-neutral-500">
											{s.count} 项
										</span>
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			) : (
				// biome-ignore lint/a11y/noStaticElementInteractions: delegates row keyboard navigation
				<div ref={setListRef} className="space-y-4" onKeyDown={handleRowKeys}>
					{grouped.map(([group, list]) => {
						const isCollapsed = collapsedGroups.has(group) && !filter.trim();
						return (
							<div key={group} className="space-y-2">
								{grouped.length > 1 && (
									<button
										type="button"
										onClick={() => toggleGroupCollapse(group)}
										className="flex w-full items-center justify-between px-1 text-left group cursor-pointer select-none"
									>
										<span className="flex items-center gap-2 text-[11px] font-semibold text-neutral-300 group-hover:text-neutral-100 transition-colors">
											<ChevronRight className={`h-3.5 w-3.5 text-neutral-500 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
											<span>{group}</span>
											<span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] font-normal text-neutral-400">
												{list.length} 项
											</span>
										</span>
										<span className="text-[10px] text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity">
											{isCollapsed ? "展开" : "折叠"}
										</span>
									</button>
								)}
								{!isCollapsed && (
									<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)] overflow-hidden">
										{activeTab === "context" && group === "上下文压缩" && <AutoCompactionCard />}
										{list.map((entry) => {
											const dep = PARENT_CHILD_MAP[entry.key];
											const hierarchyDisabled = dep ? !parentValues[dep.parent] : false;
											return (
												<ConfigRow
													key={entry.key}
													entry={entry}
													override={overrideFor(entry.key)}
													onChanged={handleChanged}
													hierarchyDisabled={hierarchyDisabled}
													hierarchyReason={hierarchyDisabled ? dep?.reason : undefined}
												/>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			{activeTab === "advanced" && !keyPrefix && !keysOnly && hiddenCount > 0 && (
				<p className="px-1 text-[11px] leading-5 text-neutral-500">
					另有 {hiddenCount} 项只对终端界面有效的设置（主题、状态栏、快捷键、输入框等）在这里不显示，
					请在终端运行 omp 后输入 /settings 修改；模型角色与备用模型请到「模型角色」页设置。
				</p>
			)}
		</div>
	);
}
