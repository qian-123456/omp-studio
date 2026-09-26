import clsx from "clsx";
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	KeyRound,
	Pencil,
	RefreshCw,
	RotateCcw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OmpConfigEntry, OmpConfigListResult } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigList, ompConfigReset, ompConfigSet } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { groupByOmpTab, groupByPrefix } from "./ompConfigTabs";

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

/** Draft text shown when entering edit mode for an entry. */
function draftFor(entry: OmpConfigEntry): string {
	if (entry.redacted) return "";
	if (entry.value === null || entry.value === undefined) {
		return entry.valueType === "array" ? "[]" : entry.valueType === "record" ? "{}" : "";
	}
	if (typeof entry.value === "string") return entry.value;
	return JSON.stringify(entry.value);
}

function ConfigRow({ entry, onChanged }: { entry: OmpConfigEntry; onChanged: () => void }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [showValue, setShowValue] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [savedTick, setSavedTick] = useState(false);
	const [rowError, setRowError] = useState<string | null>(null);

	const flashSaved = () => {
		setSavedTick(true);
		setTimeout(() => setSavedTick(false), 2000);
	};

	const startEdit = () => {
		setDraft(draftFor(entry));
		setRowError(null);
		setEditing(true);
	};

	const save = async (value: string) => {
		if (entry.valueType === "array" || entry.valueType === "record") {
			try {
				JSON.parse(value);
			} catch {
				toast.error("不是合法的 JSON");
				return;
			}
		}
		setBusy(true);
		setRowError(null);
		try {
			await ompConfigSet(entry.key, value);
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
			!(await confirmDialog(`将 ${entry.key} 重置为 OMP 默认值？`, {
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

	const badge = TYPE_BADGE[entry.valueType] ?? TYPE_BADGE.string;
	const badgeLabel = TYPE_LABEL[entry.valueType] ?? entry.valueType;
	const isBool = entry.valueType === "boolean";
	const isJson = entry.valueType === "array" || entry.valueType === "record";
	const description = entry.description.trim();

	return (
		<div className="rounded-lg border border-neutral-800/70 bg-neutral-900/50 p-2.5">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="break-all font-mono text-[11px] font-medium text-neutral-100">
							{entry.key}
						</span>
						<span
							className={`shrink-0 rounded px-1 py-0.2 text-[10px] font-medium ${badge}`}
						>
							{badgeLabel}
						</span>
						{entry.redacted && (
							<span
								className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.2 text-[10px] text-amber-300"
								title="凭据字段：值被 OMP 遮蔽，仅可覆盖写入"
							>
								<KeyRound className="h-2.5 w-2.5" />
								<span>凭据</span>
							</span>
						)}
						{savedTick && (
							<span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-400">
								<Check className="h-2.5 w-2.5" />
								<span>已保存</span>
							</span>
						)}
					</div>
					{description && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => setExpanded(!expanded)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									setExpanded(!expanded);
								}
							}}
							className={`mt-0.5 cursor-pointer text-[11px] text-neutral-500 ${
								expanded ? "" : "line-clamp-2"
							}`}
							title={expanded ? "收起说明" : "展开说明"}
						>
							{description}
						</div>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{isBool ? (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => saveBoolean(true)}
								className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
									entry.value === true
										? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
										: "border-neutral-700 text-neutral-400 hover:text-neutral-200"
								}`}
							>
								开启
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => saveBoolean(false)}
								className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
									entry.value === false
										? "border-neutral-500 bg-neutral-700 text-neutral-100"
										: "border-neutral-700 text-neutral-400 hover:text-neutral-200"
								}`}
							>
								关闭
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								disabled={busy || editing}
								onClick={startEdit}
								title={entry.redacted ? "输入以覆盖已配置的值" : "编辑"}
								className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
							>
								<Pencil className="h-3 w-3" />
							</button>
							<button
								type="button"
								disabled={busy || editing}
								onClick={reset}
								title="重置为默认值"
								className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-amber-300 disabled:opacity-50"
							>
								<RotateCcw className="h-3 w-3" />
							</button>
						</>
					)}
				</div>
			</div>

			{/* Current value / inline editor */}
			{editing ? (
				<div className="mt-2">
					{isJson ? (
						<textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={4}
							spellCheck={false}
							placeholder={entry.valueType === "array" ? '["a","b"]' : '{"k":"v"}'}
							className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:border-amber-500 focus:outline-none"
						/>
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
							className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 font-mono text-[11px] text-neutral-200 focus:border-amber-500 focus:outline-none"
						/>
					)}
					{entry.valueType === "enum" && (
						<div className="mt-1 text-[10px] text-neutral-500">
							枚举值需与 OMP 允许值完全匹配（可先运行 omp config set 查看错误提示中的可选值）
						</div>
					)}
					<div className="mt-1.5 flex items-center gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => void save(draft)}
							className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
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
							onClick={() => setEditing(false)}
							className="rounded-lg px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
						>
							取消
						</button>
					</div>
				</div>
			) : (
				<div className="mt-1.5 flex items-center gap-2">
					<span
						className={`break-all font-mono text-[11px] ${
							entry.value === null || entry.value === undefined
								? "text-neutral-600"
								: entry.redacted
									? "text-amber-300/70"
									: "text-neutral-300"
						}`}
					>
						{formatValue(entry)}
					</span>
					{entry.redacted && (entry.value === null || entry.value === undefined) && (
						<span className="text-[10px] text-neutral-600">（未配置）</span>
					)}
				</div>
			)}

			{rowError && (
				<div className="mt-1.5 flex items-start gap-1 rounded-lg border border-rose-800/50 bg-rose-950/30 p-1.5 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{rowError}</span>
				</div>
			)}
		</div>
	);
}

/** Entries grouped by their top-level key prefix, with a small mono section header. */
function PrefixEntryList({
	entries,
	onChanged,
}: {
	entries: OmpConfigEntry[];
	onChanged: () => void;
}) {
	return (
		<div className="space-y-1.5">
			{groupByPrefix(entries).map(([prefix, rows]) => (
				<div key={prefix}>
					<div className="px-1 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wide text-neutral-600">
						{prefix}
						<span className="ml-1.5 normal-case tracking-normal text-neutral-700">
							{rows.length} 项
						</span>
					</div>
					<div className="space-y-2">
						{rows.map((entry) => (
							<ConfigRow key={entry.key} entry={entry} onChanged={onChanged} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/** Settings section bridging to OMP's own config system (`omp config list/set/reset`). */
export function OmpConfigSection() {
	const [result, setResult] = useState<OmpConfigListResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [activeTab, setActiveTab] = useState<string>("all");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [reloadTick, setReloadTick] = useState(0);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		ompConfigList()
			.then((r) => {
				if (alive) setResult(r);
			})
			.catch((e) => {
				if (alive) {
					setResult({ found: false, entries: [], error: errMsg(e) });
				}
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [reloadTick]);

	const allGroups = useMemo(
		() => groupByOmpTab(result?.entries ?? []),
		[result],
	);
	const countByTab = useMemo(() => {
		const counts = new Map<string, number>([["all", result?.entries.length ?? 0]]);
		for (const g of allGroups) counts.set(g.id, g.entries.length);
		return counts;
	}, [allGroups, result]);

	const searching = query.trim().length > 0;
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const entries = result?.entries ?? [];
		if (!q) return entries;
		return entries.filter(
			(e) =>
				e.key.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
		);
	}, [result, query]);

	const visibleGroups = useMemo(() => {
		const groups = groupByOmpTab(filtered);
		return activeTab === "all"
			? groups
			: groups.filter((g) => g.id === activeTab);
	}, [filtered, activeTab]);

	const toggleGroup = (group: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(group)) {
				next.delete(group);
			} else {
				next.add(group);
			}
			return next;
		});
	};

	const handleChanged = () => {
		// Re-list so edited values (and booleans in other rows) stay in sync with omp.
		setReloadTick((t) => t + 1);
	};

	if (loading) {
		return (
			<div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-xs text-neutral-500">
				<RefreshCw className="h-4 w-4 animate-spin" />
				<span>正在读取 OMP 配置项...</span>
			</div>
		);
	}

	if (result && !result.found) {
		return (
			<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
				<AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500/70" />
				<div className="text-xs font-medium text-neutral-300">
					无法读取 OMP 配置
				</div>
				<div className="mx-auto mt-1 max-w-md break-all text-[11px] text-neutral-500">
					{result.error ?? "未知错误"}
				</div>
				<div className="mx-auto mt-2 max-w-md text-[11px] text-neutral-500">
					请确认本机已安装 omp，并在 系统设置 → 高级 → OMP 命令行程序
					中检查二进制路径是否正确
				</div>
				<button
					type="button"
					onClick={() => setReloadTick((t) => t + 1)}
					className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
				>
					<RefreshCw className="h-3.5 w-3.5" />
					<span>重试</span>
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="搜索配置键或说明..."
						className="w-full rounded-lg border border-neutral-700 bg-neutral-950 py-1.5 pl-8 pr-3 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
					/>
				</div>
				<span className="shrink-0 text-[11px] text-neutral-500">
					{filtered.length}/{result?.entries.length ?? 0} 项
				</span>
				<button
					type="button"
					onClick={handleChanged}
					title="重新读取 OMP 配置"
					className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-300 hover:bg-neutral-700"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			</div>

			{/* Official OMP settings tabs as category chips */}
			<div className="flex flex-wrap gap-1.5">
				<button
					type="button"
					onClick={() => setActiveTab("all")}
					className={clsx(
						"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
						activeTab === "all"
							? "border-amber-500/50 bg-amber-500/15 text-amber-300"
							: "border-neutral-700/70 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
					)}
				>
					<span>全部</span>
					<span className="text-[10px] text-neutral-500">
						{countByTab.get("all") ?? 0}
					</span>
				</button>
				{allGroups.map((g) => (
					<button
						key={g.id}
						type="button"
						onClick={() => setActiveTab(g.id)}
						className={clsx(
							"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
							activeTab === g.id
								? "border-amber-500/50 bg-amber-500/15 text-amber-300"
								: "border-neutral-700/70 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
						)}
					>
						<span>{g.label}</span>
						<span className="text-[10px] text-neutral-500">
							{g.entries.length}
						</span>
					</button>
				))}
			</div>

			{visibleGroups.length === 0 ? (
				<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center text-xs text-neutral-500">
					没有匹配的配置项
				</div>
			) : (
				<div className="space-y-2">
					{visibleGroups.map((group) => {
						const isCollapsed =
							activeTab === "all" && !searching && collapsed.has(group.id);
						return (
							<div
								key={group.id}
								className="rounded-xl border border-neutral-800 bg-neutral-900/40"
							>
								<button
									type="button"
									onClick={() =>
										activeTab === "all"
											? toggleGroup(group.id)
											: setActiveTab("all")
									}
									className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left"
								>
									{isCollapsed ? (
										<ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
									) : (
										<ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
									)}
									<span className="text-xs font-semibold text-neutral-200">
										{group.label}
									</span>
									<span className="rounded bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400">
										{group.entries.length}
									</span>
									{activeTab === "all" && !searching && (
										<span className="ml-auto text-[10px] text-neutral-600">
											OMP 官方分组
										</span>
									)}
								</button>
								{!isCollapsed && (
									<div className="px-2 pb-2 pt-0">
										<PrefixEntryList
											entries={group.entries}
											onChanged={handleChanged}
										/>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
