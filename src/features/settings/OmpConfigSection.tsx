import {
	AlertTriangle,
	Check,
	KeyRound,
	Pencil,
	RefreshCw,
	RotateCcw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OmpConfigEntry } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigReset, ompConfigSet } from "../../lib/ipc";
import { NativeSelect } from "../../components/NativeSelect";
import { Switch } from "./Switch";
import { useOmpConfigStore } from "./ompConfigStore";
import {
	ompConfigDescription,
	ompConfigGroup,
	ompConfigOptionLabel,
	ompConfigOptions,
	ompConfigTitle,
} from "./ompConfigMeta";
import { groupByDesktopCategory } from "./ompDesktopCategories";

const TYPE_BADGE: Record<string, string> = {
	boolean: "bg-emerald-500/15 text-emerald-300",
	number: "bg-sky-500/15 text-sky-300",
	string: "bg-neutral-700/60 text-neutral-300",
	enum: "bg-violet-500/15 text-violet-300",
	array: "bg-amber-500/15 text-amber-300",
	record: "bg-rose-500/15 text-rose-300",
};

const TYPE_LABEL: Record<string, string> = {
	boolean: "开关",
	number: "数字",
	string: "文本",
	enum: "枚举",
	array: "数组",
	record: "对象",
};

function formatValue(entry: OmpConfigEntry): string {
	if (entry.redacted) return "••••••";
	if (entry.value === null || entry.value === undefined) return "未设置";
	if (typeof entry.value === "string") return entry.value;
	return JSON.stringify(entry.value);
}

/** Short summary for the collapsed value column; the full value stays in the tooltip. */
function formatValueSummary(entry: OmpConfigEntry): string {
	if (entry.redacted) return "••••••";
	if (entry.value === null || entry.value === undefined) return "未设置";
	if (Array.isArray(entry.value)) return `[${entry.value.length} 项]`;
	if (typeof entry.value === "object") {
		return `{${Object.keys(entry.value as Record<string, unknown>).length} 键}`;
	}
	if (typeof entry.value === "string") return entry.value;
	return JSON.stringify(entry.value);
}

/** Draft text shown when entering edit mode for an entry. */
function draftFor(entry: OmpConfigEntry): string {
	if (entry.redacted) return "";
	if (entry.value === null || entry.value === undefined) {
		return entry.valueType === "array" ? "[]" : entry.valueType === "record" ? "{}" : "";
	}
	if (typeof entry.value === "string") return entry.value;
	// Pretty-print structured values so the JSON editor stays readable.
	return JSON.stringify(entry.value, null, 2);
}

/**
 * One config entry. Collapsed by default: readable title left, current value /
 * switch right. Clicking the row expands the long description plus the program
 * key and type badges; booleans toggle via the macOS-style switch directly.
 */
/** Sentinel select value for the "type a custom value" escape hatch. */
const CUSTOM_VALUE = "__custom__";

function ConfigRow({ entry, onChanged }: { entry: OmpConfigEntry; onChanged: () => void }) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [showValue, setShowValue] = useState(false);
	const [custom, setCustom] = useState(false);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);
	const [rowError, setRowError] = useState<string | null>(null);

	const flashSaved = () => {
		setSavedTick(true);
		setTimeout(() => setSavedTick(false), 2000);
	};

	const startEdit = () => {
		const next = draftFor(entry);
		setDraft(next);
		setCustom(
			options !== null && !options.some((o) => o.value === next),
		);
		setRowError(null);
		setEditing(true);
	};

	const save = async (value: string) => {
		let finalValue = value;
		if (entry.valueType === "array" || entry.valueType === "record") {
			try {
				finalValue = JSON.stringify(JSON.parse(value));
			} catch {
				setRowError("JSON 格式不正确，请检查后重试");
				return;
			}
		}
		setBusy(true);
		setRowError(null);
		try {
			await ompConfigSet(entry.key, finalValue);
			flashSaved();
			setEditing(false);
			onChanged();
		} catch (e) {
			setRowError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const saveBoolean = async (value: boolean) => {
		if (busy) return;
		setBusy(true);
		setRowError(null);
		try {
			await ompConfigSet(entry.key, value ? "true" : "false");
			flashSaved();
			onChanged();
		} catch (e) {
			setRowError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const reset = async () => {
		if (
			!(await confirmDialog(`将「${ompConfigTitle(entry.key)}」(${entry.key}) 重置为 OMP 默认值？`, {
				danger: true,
				okLabel: "重置",
			}))
		) {
			return;
		}
		setBusy(true);
		setRowError(null);
		try {
			await ompConfigReset(entry.key);
			flashSaved();
			onChanged();
		} catch (e) {
			setRowError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const title = ompConfigTitle(entry.key);
	const detailDescription = ompConfigDescription(entry.key, entry.description).trim();
	const badge = TYPE_BADGE[entry.valueType] ?? TYPE_BADGE.string;
	const badgeLabel = TYPE_LABEL[entry.valueType] ?? entry.valueType;
	const isBool = entry.valueType === "boolean";
	const isJson = entry.valueType === "array" || entry.valueType === "record";
	const isUnset = entry.value === null || entry.value === undefined;
	// Dropdown choices from the embedded schema (strict enums, or presets for
	// numbers/strings); redacted and JSON fields stay free-form.
	const options = isJson || entry.redacted ? null : ompConfigOptions(entry.key);
	const optionLabel = (o: { value: string; label?: string }) => {
		const label = ompConfigOptionLabel(entry.key, o);
		// Schema-authored labels (e.g. "10%", "8x8 repeated, black") already present
		// the value; only curated Chinese labels get the raw value appended.
		if (label === o.value || (o.label !== undefined && label === o.label)) {
			return label;
		}
		return `${label}（${o.value}）`;
	};

	return (
		<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card transition-all">
			{/* Collapsed row: title + value/switch */}
			<div
				role="button"
				tabIndex={0}
				onClick={() => setOpen(!open)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen(!open);
					}
				}}
				className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#0A84FF]/40 rounded-xl"
			>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate text-xs font-semibold tracking-[-0.01em] text-neutral-100" title={entry.key}>
							{title}
						</span>
						{entry.redacted && (
							<span
								className="shrink-0"
								title="凭据字段：值被 OMP 遮蔽，仅可覆盖写入"
							>
								<KeyRound className="h-3 w-3 text-amber-300/80" />
							</span>
						)}
						{savedTick && (
							<span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-400">
								<Check className="h-2.5 w-2.5" />
								<span>已保存</span>
							</span>
						)}
					</div>
					{isBool && (
						<div className="mt-0.5 font-mono text-[10px] text-neutral-600">
							{entry.value === true ? "已开启" : entry.value === false ? "已关闭" : "未设置"}
						</div>
					)}
				</div>

				<div
					className="flex shrink-0 items-center gap-1"
					onClick={(e) => e.stopPropagation()}
				>
					{!isBool && (
						<span
							className={`max-w-80 truncate font-mono text-[11px] ${
								isUnset
									? "text-neutral-600"
									: entry.redacted
										? "text-amber-300/70"
										: "text-neutral-400"
							}`}
							title={formatValue(entry)}
						>
							{formatValueSummary(entry)}
						</span>
					)}
					{isBool ? (
						<Switch
							checked={entry.value === true}
							disabled={busy}
							onChange={saveBoolean}
						/>
					) : (
						<>
							<button
								type="button"
								disabled={busy || editing}
								onClick={startEdit}
								title={entry.redacted ? "输入以覆盖已配置的值" : "编辑"}
								className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
							>
								<Pencil className="h-3 w-3" />
							</button>
							<button
								type="button"
								disabled={busy || editing}
								onClick={reset}
								title="重置为默认值"
								className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-amber-300 active:scale-95 transition-all disabled:opacity-50"
							>
								<RotateCcw className="h-3 w-3" />
							</button>
						</>
					)}
				</div>
			</div>

			{/* Expanded detail: description + program key + badges */}
			{open && !editing && (
				<div className="space-y-1.5 border-t border-[var(--border-divider)] px-3 py-2">
					{detailDescription && (
						<p className="text-[11px] leading-5 text-neutral-400">{detailDescription}</p>
					)}
					<div className="flex flex-wrap items-center gap-1.5">
						<span
							className={`shrink-0 rounded px-1 py-0.2 text-[9px] font-medium ${badge}`}
						>
							{badgeLabel}
						</span>
						{entry.redacted && (
							<span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300">
								<KeyRound className="h-2.5 w-2.5" />
								<span>凭据</span>
							</span>
						)}
						<span className="break-all font-mono text-[10px] text-neutral-600">
							{entry.key}
						</span>
					</div>
				</div>
			)}

			{/* Inline editor */}
			{editing ? (
				<div className="space-y-1.5 border-t border-[var(--border-divider)] px-3 py-2">
					{isJson ? (
						<textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={4}
							spellCheck={false}
							placeholder={entry.valueType === "array" ? '["a","b"]' : '{"k":"v"}'}
							className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
						/>
					) : options ? (
						<div className="space-y-1.5">
							<NativeSelect
								value={
									custom || !options.some((o) => o.value === draft)
										? CUSTOM_VALUE
										: draft
								}
								disabled={busy}
								onChange={(e) => {
									if (e.target.value === CUSTOM_VALUE) {
										setCustom(true);
									} else {
										setCustom(false);
										setDraft(e.target.value);
									}
								}}
								className="text-[11px]"
							>
								{options.map((o) => (
									<option key={o.value} value={o.value}>
										{optionLabel(o)}
									</option>
								))}
								<option value={CUSTOM_VALUE}>自定义…</option>
							</NativeSelect>
							{custom && (
								<input
									type="text"
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if (e.key === "Enter") {
											e.preventDefault();
											void save(draft);
										}
										if (e.key === "Escape") {
											setEditing(false);
										}
									}}
									spellCheck={false}
									autoFocus
									placeholder="输入自定义值"
									className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
								/>
							)}
						</div>
					) : (
						<input
							type={entry.redacted && !showValue ? "password" : "text"}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									void save(draft);
								}
								if (e.key === "Escape") {
									setEditing(false);
								}
							}}
							spellCheck={false}
							autoFocus
							placeholder={
								entry.redacted ? "•••••• 已配置，输入以覆盖" : "输入新值"
							}
							className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
						/>
					)}
					{entry.valueType === "enum" && !options && (
						<div className="text-[10px] text-neutral-500">
							枚举值需与 OMP 允许值完全匹配（可先运行 omp config set 查看错误提示中的可选值）
						</div>
					)}
					<div className="flex items-center gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => void save(draft)}
							className="rounded-lg bg-[#0A84FF] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm disabled:opacity-50"
						>
							{busy ? "保存中..." : "保存"}
						</button>
						{entry.redacted && (
							<button
								type="button"
								onClick={() => setShowValue(!showValue)}
								className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300"
							>
								{showValue ? (
									<>
										<X className="h-3 w-3" />
										<span>隐藏输入</span>
									</>
								) : (
									<>
										<KeyRound className="h-3 w-3" />
										<span>显示输入</span>
									</>
								)}
							</button>
						)}
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setEditing(false);
								setRowError(null);
							}}
							className="rounded-lg px-2 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
						>
							取消
						</button>
					</div>
				</div>
			) : null}

			{rowError && (
				<div className="flex items-start gap-1 border-t border-rose-800/40 bg-rose-950/20 px-3 py-1.5 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{rowError}</span>
				</div>
			)}
		</div>
	);
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
	seedQuery,
}: {
	activeTab: string;
	onTabChange: (tab: string) => void;
	/** Schema sub-group (Theme / Composer / …); null shows the whole tab. */
	activeGroupName: string | null;
	onGroupChange: (group: string | null) => void;
	/** External query seeded from the settings nav search; internal box wins after edits. */
	seedQuery?: string;
}) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);

	const [query, setQuery] = useState("");

	// Seed from the nav-level search; typed edits here stay until the nav query changes.
	useEffect(() => {
		if (seedQuery !== undefined && seedQuery !== query) setQuery(seedQuery);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [seedQuery]);

	useEffect(() => {
		void load();
	}, [load]);

	const allGroups = useMemo(
		() =>
			groupByDesktopCategory(entries).map((g) => ({
				id: g.category.id,
				label: g.category.label,
				hint: g.category.hint,
				entries: g.entries,
			})),
		[entries],
	);
	const activeGroup =
		allGroups.find((g) => g.id === activeTab) ?? allGroups[0] ?? null;

	const tabGroupNames = useMemo(
		() =>
			new Set(
				(activeGroup?.entries ?? []).map((e) => ompConfigGroup(e.key) ?? "其他"),
			),
		[activeGroup],
	);
	// Recover from a stale group (disappeared after omp upgrade).
	useEffect(() => {
		if (activeGroupName && !tabGroupNames.has(activeGroupName)) {
			onGroupChange(null);
		}
	}, [activeGroupName, tabGroupNames, onGroupChange]);

	// Recover from a stale selection (tab disappeared after omp upgrade).
	useEffect(() => {
		if (allGroups.length > 0 && !allGroups.some((g) => g.id === activeTab)) {
			onTabChange(allGroups[0].id);
		}
	}, [allGroups, activeTab, onTabChange]);

	const rows = useMemo(() => {
		const base = activeGroupName
			? (activeGroup?.entries ?? []).filter(
					(e) => (ompConfigGroup(e.key) ?? "其他") === activeGroupName,
				)
			: (activeGroup?.entries ?? []);
		const q = query.trim().toLowerCase();
		if (!q) return base;
		return base.filter(
			(e) =>
				e.key.toLowerCase().includes(q) ||
				e.description.toLowerCase().includes(q) ||
				ompConfigTitle(e.key).toLowerCase().includes(q) ||
				ompConfigDescription(e.key, e.description).toLowerCase().includes(q),
		);
	}, [activeGroup, activeGroupName, query]);

	// Sub-groups by schema group ("Theme", "Composer", …); settings without UI
	// metadata land in a trailing 其他 bucket instead of raw key-name headers.
	const grouped = useMemo(() => {
		const named = new Map<string, OmpConfigEntry[]>();
		const other: OmpConfigEntry[] = [];
		for (const entry of rows) {
			const group = ompConfigGroup(entry.key);
			if (group) {
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
		const result = [...named.entries()];
		if (other.length > 0) result.push(["其他", other]);
		return result;
	}, [rows]);

	// When the current tab has no matches, point at other tabs that do.
	const suggestions = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return allGroups
			.filter((g) => g.id !== activeGroup?.id)
			.map((g) => ({
				id: g.id,
				label: g.label,
				count: g.entries.filter(
					(e) =>
						e.key.toLowerCase().includes(q) ||
						e.description.toLowerCase().includes(q) ||
						ompConfigTitle(e.key).toLowerCase().includes(q),
				).length,
			}))
			.filter((s) => s.count > 0);
	}, [allGroups, activeGroup, query]);

	const handleChanged = () => {
		// Re-list so edited values (and switches elsewhere) stay in sync with omp.
		void load(true);
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
		<div className="space-y-3">
			<div>
				<div className="flex items-baseline gap-1.5">
					<h3 className="text-sm font-semibold text-neutral-100">
						{activeGroup?.label}
					</h3>
					{activeGroupName && (
						<>
							<span className="text-xs text-neutral-600">›</span>
							<span className="text-xs text-neutral-400">{activeGroupName}</span>
						</>
					)}
				</div>
				{activeGroup?.hint && (
					<div className="mt-0.5 text-[11px] text-neutral-600">
						{activeGroup.hint}
					</div>
				)}
			</div>
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={`在「${activeGroupName ?? activeGroup?.label ?? ""}」中搜索配置...`}
						className="w-full rounded-lg hairline bg-[var(--well-bg)] py-1.5 pl-8 pr-3 text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
					/>
				</div>
				<span className="shrink-0 text-[11px] text-neutral-500">
					{rows.length}/{activeGroup?.entries.length ?? 0} 项
				</span>
				<button
					type="button"
					onClick={handleChanged}
					title="重新读取 OMP 配置"
					className="shrink-0 rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-xl hairline bg-[var(--bg-panel)] p-6 text-center text-xs text-neutral-500 shadow-apple-card">
					<div>没有匹配的配置项</div>
					{suggestions.length > 0 && (
						<div className="mt-3 space-y-2">
							<div>以下分类有匹配，点击切换：</div>
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
				<div className="space-y-3">
					{grouped.map(([group, list]) => (
						<div key={group} className="space-y-2">
							{grouped.length > 1 && (
								<div className="px-1 text-[11px] font-semibold text-neutral-400">
									{group}
									<span className="ml-1.5 text-[10px] font-normal text-neutral-600">
										{list.length} 项
									</span>
								</div>
							)}
							{list.map((entry) => (
								<ConfigRow
									key={entry.key}
									entry={entry}
									onChanged={handleChanged}
								/>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
