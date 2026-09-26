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
import { toast } from "../../lib/toast";
import { Switch } from "./Switch";
import { useOmpConfigStore } from "./ompConfigStore";
import { groupByOmpTab } from "./ompConfigTabs";

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

/**
 * One config entry: the human-readable description is the primary title and the
 * program key is small secondary text; booleans render a macOS-style switch.
 */
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

	const description = entry.description.trim();
	const badge = TYPE_BADGE[entry.valueType] ?? TYPE_BADGE.string;
	const badgeLabel = TYPE_LABEL[entry.valueType] ?? entry.valueType;
	const isBool = entry.valueType === "boolean";
	const isJson = entry.valueType === "array" || entry.valueType === "record";

	return (
		<div className="rounded-lg border border-neutral-800/70 bg-neutral-900/50 p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					{/* Primary title: real meaning (description); key is secondary. */}
					<div
						role={description ? "button" : undefined}
						tabIndex={description ? 0 : undefined}
						onClick={() => {
							if (description) setExpanded(!expanded);
						}}
						onKeyDown={(e) => {
							if (description && e.key === "Enter") {
								e.preventDefault();
								setExpanded(!expanded);
							}
						}}
						title={description ? (expanded ? "收起" : "展开") : undefined}
					>
						<span
							className={`text-xs font-medium leading-5 text-neutral-100 ${
								description && !expanded ? "line-clamp-2" : ""
							}`}
						>
							{description || entry.key}
						</span>
					</div>

					{description ? (
						<div className="mt-0.5 flex flex-wrap items-center gap-1.5">
							<span className="break-all font-mono text-[10px] text-neutral-500">
								{entry.key}
							</span>
							<span
								className={`shrink-0 rounded px-1 py-0.2 text-[9px] font-medium ${badge}`}
							>
								{badgeLabel}
							</span>
							{entry.redacted && (
								<span
									className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300"
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
					) : (
						<div className="mt-0.5 flex flex-wrap items-center gap-1.5">
							<span
								className={`shrink-0 rounded px-1 py-0.2 text-[9px] font-medium ${badge}`}
							>
								{badgeLabel}
							</span>
							{entry.redacted && (
								<span
									className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300"
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
					)}

					{/* Current value (booleans show their switch instead). */}
					{!isBool && !editing && (
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
							{entry.redacted &&
								(entry.value === null || entry.value === undefined) && (
									<span className="text-[10px] text-neutral-600">（未配置）</span>
								)}
						</div>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1 pt-0.5">
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

			{/* Inline editor */}
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
			) : null}

			{rowError && (
				<div className="mt-1.5 flex items-start gap-1 rounded-lg border border-rose-800/50 bg-rose-950/30 p-1.5 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{rowError}</span>
				</div>
			)}
		</div>
	);
}

/**
 * Settings panel bridging to OMP's own config system (`omp config list/set/reset`).
 * The official OMP tab is selected from the settings left nav (controlled from
 * outside); this panel renders only the selected category's entries.
 */
export function OmpConfigSection({
	activeTab,
	onTabChange,
}: {
	activeTab: string;
	onTabChange: (tab: string) => void;
}) {
	const entries = useOmpConfigStore((s) => s.entries);
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);

	const [query, setQuery] = useState("");

	useEffect(() => {
		void load();
	}, [load]);

	const allGroups = useMemo(() => groupByOmpTab(entries), [entries]);
	const activeGroup =
		allGroups.find((g) => g.id === activeTab) ?? allGroups[0] ?? null;

	// Recover from a stale selection (tab disappeared after omp upgrade).
	useEffect(() => {
		if (allGroups.length > 0 && !allGroups.some((g) => g.id === activeTab)) {
			onTabChange(allGroups[0].id);
		}
	}, [allGroups, activeTab, onTabChange]);

	const rows = useMemo(() => {
		const base = activeGroup?.entries ?? [];
		const q = query.trim().toLowerCase();
		if (!q) return base;
		return base.filter(
			(e) =>
				e.key.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
		);
	}, [activeGroup, query]);

	const handleChanged = () => {
		// Re-list so edited values (and switches elsewhere) stay in sync with omp.
		void load(true);
	};

	if (loading && !loaded) {
		return (
			<div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-xs text-neutral-500">
				<RefreshCw className="h-4 w-4 animate-spin" />
				<span>正在读取 OMP 配置项...</span>
			</div>
		);
	}

	if (error && !loaded) {
		return (
			<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
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
						placeholder={`在「${activeGroup?.label ?? ""}」中搜索配置...`}
						className="w-full rounded-lg border border-neutral-700 bg-neutral-950 py-1.5 pl-8 pr-3 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
					/>
				</div>
				<span className="shrink-0 text-[11px] text-neutral-500">
					{rows.length}/{activeGroup?.entries.length ?? 0} 项
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

			{rows.length === 0 ? (
				<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center text-xs text-neutral-500">
					没有匹配的配置项
				</div>
			) : (
				<div className="space-y-2">
					{rows.map((entry) => (
						<ConfigRow key={entry.key} entry={entry} onChanged={handleChanged} />
					))}
				</div>
			)}
		</div>
	);
}
