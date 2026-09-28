import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
	Activity,
	ChevronDown,
	ChevronRight,
	CircleCheck,
	CircleX,
	ClipboardCopy,
	Download,
	FileInput,
	Folder,
	FolderOpen,
	Loader2,
	LogIn,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import type {
	ModelEntry,
	OmpImportResult,
	OmpProviderInfo,
	ProviderConfig,
} from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { canImportOmpProvider, getOmpAuthBadge } from "./ompBadge";
import { OauthLoginDialog } from "./OauthLoginDialog";
import { API_LABELS, presetById } from "./presets";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { useProviders, type TestStatus } from "./store";
import { formatTokens, modelEntryId, modelEntrySpec } from "./modelEntry";

const PRIVACY_NOTE =
	"密钥使用 macOS 钥匙串加密后存于 ~/.omp-workspace/env/keys.env，明文仅在内存中出现，不会写入数据库或日志。";

/** One row in the unified provider list — may carry both an OMP-discovered
 * config and a workbench-managed copy (matched by slug). */
interface ListRow {
	key: string;
	/** OMP config (models.yml/config.yml/agent.db), when the provider exists there. */
	omp: OmpProviderInfo | null;

	workbench: ProviderConfig | null;
}

export function ProviderPanel() {
	const providers = useProviders((s) => s.providers);
	const loaded = useProviders((s) => s.loaded);
	const error = useProviders((s) => s.error);
	const load = useProviders((s) => s.load);
	const ompProviders = useProviders((s) => s.ompProviders);
	const ompLoaded = useProviders((s) => s.ompLoaded);
	const ompError = useProviders((s) => s.ompError);
	const exportEnvText = useProviders((s) => s.exportEnvText);
	const importingOmp = useProviders((s) => s.importingOmp);
	const importOmp = useProviders((s) => s.importOmp);
	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [oauthDialogOpen, setOauthDialogOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [expandedKey, setExpandedKey] = useState<string | null>(null);
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

	const toggleGroup = (tier: string) => {
		setCollapsedGroups((prev) => ({ ...prev, [tier]: !prev[tier] }));
	};

	useEffect(() => {
		void load();
	}, [load]);

	// Merge OMP-discovered providers and workbench-managed ones into one list,
	// keyed by slug so the same provider never appears twice.
	const rows = useMemo<ListRow[]>(() => {
		const map = new Map<string, ListRow>();
		for (const info of ompProviders) {
			map.set(info.id, { key: info.id, omp: info, workbench: null });
		}
		for (const cfg of providers) {
			const existing = map.get(cfg.slug);
			if (existing) {
				existing.workbench = cfg;
			} else {
				map.set(cfg.slug, { key: cfg.slug, omp: null, workbench: cfg });
			}
		}
		const list = [...map.values()];
		list.sort((a, b) => {
			// Managed rows first, then OMP-configured, then workbench-only;
			// within a tier sort by id/name.
			const ra = a.workbench ? (a.omp ? 0 : 2) : 1;
			const rb = b.workbench ? (b.omp ? 0 : 2) : 1;
			if (ra !== rb) return ra - rb;
			const an = a.omp?.id ?? a.workbench?.name ?? "";
			const bn = b.omp?.id ?? b.workbench?.name ?? "";
			return an.localeCompare(bn);
		});
		return list;
	}, [ompProviders, providers]);

	const filteredRows = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((r) => {
			const haystack = [
				r.omp?.id,
				r.workbench?.name,
				r.workbench?.slug,
				r.omp?.baseUrl ?? r.workbench?.baseUrl,
				...(r.omp?.modelIds ?? r.workbench?.models ?? []),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(q);
		});
	}, [rows, query]);

	const groups = useMemo(() => {
		const g0: ListRow[] = [];
		const g1: ListRow[] = [];
		const g2: ListRow[] = [];
		for (const row of filteredRows) {
			const tier = row.workbench ? (row.omp ? 0 : 2) : 1;
			if (tier === 0) g0.push(row);
			else if (tier === 1) g1.push(row);
			else g2.push(row);
		}
		return [
			{ label: "已托管", rows: g0 },
			{ label: "待导入", rows: g1 },
			{ label: "工作台私有", rows: g2 },
		].filter((g) => g.rows.length > 0);
	}, [filteredRows]);

	const eligibleOmpIds = useMemo(
		() => ompProviders.filter(canImportOmpProvider).map((p) => p.id),
		[ompProviders],
	);

	const handleImportAll = async () => {
		if (eligibleOmpIds.length === 0 || importingOmp) return;
		try {
			const results = await importOmp(eligibleOmpIds);
			notifyImportResults(results);
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
		}
	};

	const handleExport = async () => {
		try {
			const text = (await exportEnvText()).trim();
			if (!text) {
				toast.info("还没有已配置密钥的供应商可导出");
				return;
			}
			await copyText(text);
			toast.success("已复制明文 .env 到剪贴板（注意保密，粘贴后及时清空）");
		} catch (err) {
			toast.error(`导出失败: ${errMsg(err)}`);
		}
	};

	const combinedError = error ?? ompError;
	const isLoading =
		(!loaded && !error) || (!ompLoaded && !ompError);
	const totalCount = rows.length;
	const managedCount = rows.filter((r) => r.workbench).length;

	return (
		<div className="space-y-4">
			{/* Fixed action bar — always visible, never scrolled away. */}
			<div className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-semibold text-neutral-100">
							API 供应商
						</h2>
						<p className="mt-0.5 text-xs text-neutral-400">
							{totalCount} 个（{managedCount} 个已由工作台托管密钥）·
							读取 ~/.omp/agent 与 providers.json
						</p>
					</div>
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" />
							<input
								type="text"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="筛选…"
								aria-label="筛选供应商"
								className="w-32 rounded-lg hairline bg-[var(--well-bg)] py-1.5 pl-7 pr-2 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#0A84FF]/50"
							/>
						</div>
						{eligibleOmpIds.length > 0 && (
							<button
								type="button"
								onClick={() => void handleImportAll()}
								disabled={importingOmp}
								title="将全部 OMP 已配置供应商的密钥加密导入工作台密钥库"
								aria-label="一键导入"
								className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-40"
							>
								{importingOmp ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Download className="h-3.5 w-3.5" />
								)}
								<span>一键导入</span>
							</button>
						)}
						<button
							type="button"
							onClick={() => void handleExport()}
							className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
							title="导出明文 .env 文本，仅复制到剪贴板"
						>
							<ClipboardCopy className="h-3.5 w-3.5" />
							<span>复制 .env</span>
						</button>
						<button
							type="button"
							onClick={() => setDialog({ mode: "import" })}
							className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
						>
							<FileInput className="h-3.5 w-3.5" />
							<span>.env 导入</span>
						</button>
						<button
							type="button"
							onClick={() => setOauthDialogOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
						>
							<LogIn className="h-3.5 w-3.5" />
							<span>OAuth 登录</span>
						</button>
						<button
							type="button"
							onClick={() => setDialog({ mode: "add" })}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm"
						>
							<Plus className="h-3.5 w-3.5" />
							<span>添加供应商</span>
						</button>
						<button
							type="button"
							onClick={() => {
								void load();
							}}
							title="刷新供应商"
							aria-label="刷新供应商"
							className="rounded-lg p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						>
							<RefreshCw className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>

			{combinedError && (
				<div
					role="alert"
					className="flex items-center gap-2 rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300"
				>
					<span className="min-w-0 flex-1 break-words">{combinedError}</span>
					<button
						type="button"
						onClick={() => void load()}
						className="inline-flex items-center gap-1 text-xs text-rose-200 hover:underline shrink-0"
					>
						<RefreshCw className="h-3 w-3" />
						<span>重试</span>
					</button>
				</div>
			)}

			{isLoading && !combinedError && (
				<div className="flex items-center justify-center py-6 text-neutral-500">
					<Loader2
						aria-label="加载供应商"
						size={16}
						className="animate-spin"
					/>
				</div>
			)}

			{!isLoading && !combinedError && filteredRows.length === 0 && (
				<div className="rounded-xl hairline bg-[var(--well-bg)]/40 py-6 text-center text-xs text-neutral-500">
					{rows.length === 0 ? "暂无供应商" : "没有匹配的供应商"}
				</div>
			)}

			{groups.length > 0 && (
				<div className="space-y-3">
					{groups.map((group) => {
						const isOpen = !collapsedGroups[group.label];
						return (
							<div key={group.label} className="mt-0.5">
								{/* Group Header */}
								<div
									onClick={() => toggleGroup(group.label)}
									className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--text)]/5 text-[var(--text)] transition-colors"
								>
									<div className="flex items-center gap-1.5 min-w-0 flex-1">
										{isOpen ? (
											<ChevronDown
												size={13}
												className="text-[var(--text-dim)] shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-[var(--text-dim)] shrink-0"
											/>
										)}
										{isOpen ? (
											<FolderOpen
												size={14}
												className="shrink-0 text-neutral-400"
											/>
										) : (
											<Folder
												size={14}
												className="shrink-0 text-neutral-400"
											/>
										)}
										<span className="font-bold text-[12.5px] text-[var(--text)] truncate">
											{group.label}
										</span>
										<span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-dim)]">
											{group.rows.length}
										</span>
									</div>
								</div>

								{/* Group Body */}
								{isOpen && (
									<div className="pb-1">
										<div className="pl-2 border-l-2 border-[var(--text-dim)]/40 my-0.5 ml-[22px] space-y-1.5">
											{group.rows.map((row) => (
												<UnifiedProviderRow
													key={row.key}
													row={row}
													isExpanded={expandedKey === row.key}
													onToggleExpand={() =>
														setExpandedKey((curr) =>
															curr === row.key ? null : row.key,
														)
													}
													onEdit={() => {
														if (row.workbench) {
															setDialog({
																mode: "edit",
																provider: row.workbench,
															});
														}
													}}
												/>
											))}
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			<div className="text-[11px] leading-relaxed text-neutral-600">
				{PRIVACY_NOTE}
			</div>

			{dialog && (
				<ProviderDialog target={dialog} onClose={() => setDialog(null)} />
			)}

			{oauthDialogOpen && (
				<OauthLoginDialog onClose={() => setOauthDialogOpen(false)} />
			)}
		</div>
	);
}

function notifyImportResults(results: OmpImportResult[]) {
	if (results.length === 0) return;
	const succeeded = results.filter((r) => r.ok);
	const failed = results.filter((r) => !r.ok);

	if (succeeded.length > 0) {
		toast.success(`成功导入 ${succeeded.length} 个`);
	}

	if (failed.length > 0) {
		const reasons = failed
			.slice(0, 3)
			.map((r) => `${r.id}: ${r.error || "导入失败"}`);
		if (failed.length > 3) {
			reasons.push(`还有 ${failed.length - 3} 个供应商导入失败`);
		}
		toast.error(reasons.join("\n"));
	}
}

function formatHostOnly(rawUrl: string | null | undefined): string | null {
	if (!rawUrl) return null;
	const trimmed = rawUrl.trim();
	if (!trimmed) return null;
	try {
		const candidate = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
		const parsed = new URL(candidate);
		const host = parsed.host;
		if (host) return host;
	} catch {
		// ignore
	}
	return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

function UnifiedProviderRow({
	row,
	isExpanded,
	onToggleExpand,
	onEdit,
}: {
	row: ListRow;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onEdit: () => void;
}) {
	const importOmp = useProviders((s) => s.importOmp);
	const importingOmp = useProviders((s) => s.importingOmp);
	const setEnabled = useProviders((s) => s.setEnabled);
	const remove = useProviders((s) => s.remove);
	const runTest = useProviders((s) => s.runTest);
	const runModelTest = useProviders((s) => s.runModelTest);
	const modelTests = useProviders((s) => s.modelTests);
	const test = useProviders((s) =>
		row.workbench ? s.tests[row.workbench.id] : undefined,
	);
	const [rowImporting, setRowImporting] = useState(false);

	const info = row.omp;
	const workbench = row.workbench;
	const authBadge = info ? getOmpAuthBadge(info) : null;
	const canImport = info ? canImportOmpProvider(info) : false;

	const displayName = workbench?.name ?? info?.id ?? "";
	const displaySlug = workbench?.slug ?? info?.id ?? "";
	const baseUrl = workbench?.baseUrl ?? info?.baseUrl ?? null;
	const hostOnly = formatHostOnly(baseUrl);
	const allModels: ModelEntry[] =
		workbench && workbench.models.length > 0
			? workbench.models
			: (info?.modelIds ?? []);
	const apiLabel = workbench ? API_LABELS[workbench.api] : info?.api;
	const preset = workbench ? presetById(workbench.presetId) : undefined;
	const color = preset?.color ?? "#f59e0b";
	const isOmpOnly = !workbench && Boolean(info);

	const handleRowImport = async () => {
		if (!info || rowImporting || importingOmp) return;
		setRowImporting(true);
		try {
			const results = await importOmp([info.id]);
			notifyImportResults(results);
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
		} finally {
			setRowImporting(false);
		}
	};

	const handleDelete = async () => {
		if (!workbench) return;
		const ok = await confirmDialog(
			info
				? `删除工作台私有副本「${workbench.name}」？加密密钥也会移除，但 OMP 全局配置（models.yml/agent.db）不受影响。`
				: `删除供应商「${workbench.name}」？其加密密钥也会从密钥库中移除。`,
			{ title: "删除供应商", danger: true, okLabel: "删除" },
		);
		if (!ok) return;
		try {
			await remove(workbench.id);
			toast.success("已删除");
		} catch (err) {
			toast.error(`删除失败: ${errMsg(err)}`);
		}
	};

	const notImportableTitle =
		info?.credentialTypes?.includes("oauth") && !canImport
			? "OAuth 凭据由 OMP 托管，无需导入"
			: "没有可导入的 API 密钥";

	// Collapsed single-line row (~38px, NOT a card)
	if (!isExpanded) {
		return (
			<div
				onClick={onToggleExpand}
				className="group flex min-h-[38px] cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-hover)]"
			>

				{/* Left items: Chevron + Preset dot + Name + Auth badge + host + {N} 模型 */}
				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
					<span className="shrink-0 p-0.5 text-neutral-500 transition-colors group-hover:text-neutral-300">
						<ChevronRight className="h-3 w-3" />
					</span>

					{workbench && (
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
					)}

					<span
						className="max-w-[150px] shrink-0 truncate font-mono text-xs font-semibold text-neutral-100 sm:max-w-[200px]"
						title={
							displaySlug !== displayName
								? `${displayName} (${displaySlug})`
								: displayName
						}
					>
						{displayName}
					</span>

					{/* Compact Auth badge */}
					{authBadge && (
						<span
							title={authBadge.tooltip}
							className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium border ${
								authBadge.badgeType === "oauth"
									? "bg-indigo-950/40 text-indigo-300 border-indigo-700/40"
									: authBadge.badgeType === "api_key"
										? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
										: authBadge.badgeType === "env"
											? "bg-amber-950/40 text-amber-300 border-amber-700/40"
											: "bg-neutral-800/60 text-neutral-400 border-neutral-700/40"
							}`}
						>
							<span>{authBadge.label}</span>
							{authBadge.accountSuffix && (
								<span className="max-w-[80px] truncate text-[10px] text-indigo-400/80 sm:max-w-[120px]">
									· {authBadge.accountSuffix}
								</span>
							)}
						</span>
					)}
					{!info && workbench?.hasKey && (
						<span
							title="密钥已加密存于工作台密钥库"
							className="inline-flex shrink-0 items-center rounded-full border border-emerald-700/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
						>
							API Key
						</span>
					)}
					{!info && workbench && !workbench.hasKey && workbench.api !== "ollama" && (
						<span
							title="未检测到 API 凭据"
							className="inline-flex shrink-0 items-center rounded-full border border-neutral-700/40 bg-neutral-800/60 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400"
						>
							无凭据
						</span>
					)}

					{/* BaseUrl host only */}
					{hostOnly && (
						<span
							className="max-w-[130px] truncate font-mono text-[10px] text-neutral-500 sm:max-w-[180px]"
							title={baseUrl ?? undefined}
						>
							{hostOnly}
						</span>
					)}

					{/* Model count */}
					<span className="shrink-0 font-mono text-[10px] text-neutral-500">
						{allModels.length} 模型
					</span>
				</div>

				{/* Actions zone: hover reveal + always-visible toggle/import */}
				<div
					className="flex shrink-0 items-center gap-1.5"
					onClick={(e) => e.stopPropagation()}
				>
					{workbench && (
						<div
							className={clsx(
								"flex items-center gap-1 transition-opacity duration-150",
								test?.state === "testing"
									? "opacity-100"
									: "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
							)}
						>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void runTest(workbench.id);
								}}
								disabled={test?.state === "testing"}
								title="测试连接"
								aria-label={`测试 ${workbench.name} 连接`}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-white active:scale-95 disabled:opacity-40"
							>
								{test?.state === "testing" ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<Activity size={12} />
								)}
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
								title="编辑"
							>
								<Pencil className="h-3 w-3" />
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void handleDelete();
								}}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
								title={
									info
										? "仅删除工作台私有副本与加密密钥；OMP 全局配置保留"
										: "删除"
								}
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</div>
					)}

					{info &&
						(canImport ? (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void handleRowImport();
								}}
								disabled={importingOmp || rowImporting}
								title={
									workbench
										? "重新从 OMP 配置导入密钥以更新工作台配置"
										: "将该供应商的密钥加密导入工作台密钥库"
								}
								className="inline-flex items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{rowImporting ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<Download className="h-3 w-3" />
								)}
								<span>{workbench ? "重新导入" : "导入"}</span>
							</button>
						) : (
							<span
								title={notImportableTitle}
								className="inline-flex cursor-not-allowed items-center rounded-md bg-neutral-800/40 px-2 py-0.5 text-[10px] font-medium text-neutral-500"
							>
								{info.credentialTypes?.includes("oauth") ? "OAuth 托管" : "导入"}
							</span>
						))}

					{workbench && (
						<EnabledToggle
							provider={workbench}
							onChange={(v) =>
								void setEnabled(workbench.id, v).catch((err) =>
									toast.error(`更新失败: ${errMsg(err)}`),
								)
							}
						/>
					)}
				</div>
			</div>
		);
	}

	// Expanded state: card treatment echoing highlighted trace event
	return (
		<div className="group rounded-xl hairline border-l-[3px] border-l-[#0A84FF] bg-[var(--well-bg)] p-3 transition-colors">

			{/* Header bar — clicking toggles collapse */}
			<div
				onClick={onToggleExpand}
				className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-2"
			>
				{/* Left: Chevron + Dot + Name + Slug + ApiLabel + AuthBadge */}
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<span className="shrink-0 p-0.5 text-neutral-400 transition-colors group-hover:text-neutral-200">
						<ChevronDown className="h-3.5 w-3.5" />
					</span>
					{workbench && (
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
					)}
					<span className="font-mono text-xs font-semibold text-neutral-100">
						{displayName}
					</span>
					{displaySlug !== displayName && (
						<span className="font-mono text-[10px] text-neutral-500">
							{displaySlug}
						</span>
					)}
					{apiLabel && (
						<span className="rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400">
							{apiLabel}
						</span>
					)}
					{authBadge && (
						<span
							title={authBadge.tooltip}
							className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
								authBadge.badgeType === "oauth"
									? "bg-indigo-950/40 text-indigo-300 border-indigo-700/40"
									: authBadge.badgeType === "api_key"
										? "bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
										: authBadge.badgeType === "env"
											? "bg-amber-950/40 text-amber-300 border-amber-700/40"
											: "bg-neutral-800/60 text-neutral-400 border-neutral-700/40"
							}`}
						>
							<span>{authBadge.label}</span>
							{authBadge.accountSuffix && (
								<span className="max-w-[140px] truncate text-[10px] text-indigo-400/80">
									· {authBadge.accountSuffix}
								</span>
							)}
						</span>
					)}
					{!info && workbench?.hasKey && (
						<span
							title="密钥已加密存于工作台密钥库"
							className="inline-flex items-center rounded-full border border-emerald-700/40 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
						>
							API Key
						</span>
					)}
					{!info && workbench && !workbench.hasKey && workbench.api !== "ollama" && (
						<span
							title="未检测到 API 凭据"
							className="inline-flex items-center rounded-full border border-neutral-700/40 bg-neutral-800/60 px-2 py-0.5 text-[10px] font-medium text-neutral-400"
						>
							无凭据
						</span>
					)}
				</div>

				{/* Right: Actions */}
				<div
					className="flex shrink-0 flex-wrap items-center gap-1.5"
					onClick={(e) => e.stopPropagation()}
				>
					{workbench && (
						<>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void runTest(workbench.id);
								}}
								disabled={test?.state === "testing"}
								title="测试连接"
								aria-label={`测试 ${workbench.name} 连接`}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-white active:scale-95 disabled:opacity-40"
							>
								{test?.state === "testing" ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<Activity size={12} />
								)}
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
								title="编辑"
							>
								<Pencil className="h-3 w-3" />
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void handleDelete();
								}}
								className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
								title={
									info
										? "仅删除工作台私有副本与加密密钥；OMP 全局配置保留"
										: "删除"
								}
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</>
					)}

					{info &&
						(canImport ? (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void handleRowImport();
								}}
								disabled={importingOmp || rowImporting}
								title={
									workbench
										? "重新从 OMP 配置导入密钥以更新工作台配置"
										: "将该供应商的密钥加密导入工作台密钥库"
								}
								className="inline-flex items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{rowImporting ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<Download className="h-3 w-3" />
								)}
								<span>{workbench ? "重新导入" : "导入"}</span>
							</button>
						) : (
							<span
								title={notImportableTitle}
								className="inline-flex cursor-not-allowed items-center rounded-md bg-neutral-800/40 px-2 py-0.5 text-[10px] font-medium text-neutral-500"
							>
								{info.credentialTypes?.includes("oauth") ? "OAuth 托管" : "导入"}
							</span>
						))}

					{workbench && (
						<EnabledToggle
							provider={workbench}
							onChange={(v) =>
								void setEnabled(workbench.id, v).catch((err) =>
									toast.error(`更新失败: ${errMsg(err)}`),
								)
							}
						/>
					)}
				</div>
			</div>

			{/* Provenance: 来源 line */}
			{((info && info.sources.length > 0) || workbench) && (
				<div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
					<span>来源:</span>
					{info?.sources.map((src) => (
						<span
							key={src}
							className="rounded bg-neutral-800/80 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400"
						>
							{src}
						</span>
					))}
					{workbench && (
						<span
							className="rounded border border-sky-700/40 bg-sky-950/40 px-1.5 py-0.5 font-mono text-[10px] text-sky-300/90"
						>
							providers.json
						</span>
					)}
				</div>
			)}

			{/* Full baseUrl + 角色 */}
			<div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
				{baseUrl && (
					<span
						className="max-w-[480px] break-all font-mono text-neutral-300 select-all"
						title={baseUrl}
					>
						{baseUrl}
					</span>
				)}
				{baseUrl && (allModels.length > 0 || (info?.usedInRoles.length ?? 0) > 0) && (
					<span className="text-neutral-600">·</span>
				)}
				{info && info.usedInRoles.length > 0 && (
					<span>
						角色:{" "}
						<span className="font-mono text-neutral-300">
							{info.usedInRoles.join(", ")}
						</span>
					</span>
				)}
				{!info && workbench && !workbench.hasKey && workbench.api !== "ollama" && (
					<span className="text-neutral-500">未配置密钥</span>
				)}
			</div>

			{/* Model grid */}
			<div className="mt-3 border-t border-[var(--border-divider)] pt-2.5">
				<div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
					<span className="font-medium text-neutral-300">
						模型列表（{allModels.length}）
					</span>
					{workbench?.defaultModel && (
						<span className="text-[11px]">
							默认: <code className="font-mono text-neutral-200">{workbench.defaultModel}</code>
						</span>
					)}
				</div>
				{allModels.length === 0 ? (
					<div className="rounded-lg bg-neutral-900/40 p-2.5 text-center text-xs text-neutral-500">
						未配置模型
					</div>
				) : (
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{allModels.map((entry) => {
							const id = modelEntryId(entry);
							const spec = modelEntrySpec(entry);
							const ctx =
								spec.contextWindow ?? workbench?.defaultContextWindow ?? null;
							const max =
								spec.maxTokens ?? workbench?.defaultMaxTokens ?? null;
							const testKey = workbench ? `${workbench.id}::${id}` : null;
							const modelTest = testKey ? modelTests[testKey] : undefined;

							return (
								<div
									key={id}
									title={isOmpOnly ? "导入工作台后可单独测试该模型" : undefined}
									className="flex flex-col justify-between gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)]/60 p-2.5 text-xs transition-all"
								>
									<div className="flex min-w-0 items-center justify-between gap-1.5">
										<span
											className="truncate font-mono font-medium text-neutral-200"
											title={id}
										>
											{id}
										</span>
										{workbench && (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													void runModelTest(workbench.id, id);
												}}
												disabled={modelTest?.state === "testing"}
												title={`测试模型 ${id}`}
												aria-label={`测试模型 ${id}`}
												className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--well-bg)] px-2 py-0.5 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-white active:scale-95 disabled:opacity-40"
											>
												{modelTest?.state === "testing" ? (
													<Loader2 size={11} className="animate-spin" />
												) : (
													<Activity size={11} />
												)}
												<span>测试</span>
											</button>
										)}
									</div>

									{(ctx != null || max != null) && (
										<div className="flex flex-wrap items-center gap-1 text-[10px]">
											{ctx != null && (
												<span
													className="rounded border border-sky-800/40 bg-sky-950/60 px-1.5 py-0.5 font-mono text-sky-300"
													title={`上下文窗口: ${ctx} tokens`}
												>
													ctx:{formatTokens(ctx)}
												</span>
											)}
											{max != null && (
												<span
													className="rounded border border-indigo-800/40 bg-indigo-950/60 px-1.5 py-0.5 font-mono text-indigo-300"
													title={`输出上限: ${max} tokens`}
												>
													max:{formatTokens(max)}
												</span>
											)}
										</div>
									)}

									{modelTest && (
										<div
											className={`text-[11px] ${
												modelTest.state === "testing"
													? "flex items-center gap-1 text-neutral-400"
													: modelTest.result.ok
														? "text-emerald-400"
														: "text-rose-400"
											}`}
										>
											{modelTest.state === "testing" ? (
												<>
													<Loader2 size={11} className="animate-spin" />
													<span>正在测试…</span>
												</>
											) : (
												<div
													className="flex items-center gap-1 truncate"
													title={`${modelTest.result.detail} (${modelTest.result.latencyMs}ms)`}
												>
													{modelTest.result.ok ? (
														<CircleCheck className="h-3 w-3 shrink-0" />
													) : (
														<CircleX className="h-3 w-3 shrink-0" />
													)}
													<span className="truncate">
														{modelTest.result.detail}
													</span>
													<span className="shrink-0 font-mono text-[10px] opacity-80">
														({modelTest.result.latencyMs}ms)
													</span>
												</div>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{workbench && <TestResultLine test={test} />}
		</div>
	);
}

function EnabledToggle({
	provider,
	onChange,
}: {
	provider: ProviderConfig;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-label={`启用 ${provider.name}`}
			aria-checked={provider.enabled}
			title={provider.enabled ? "已启用（新会话注入密钥）" : "已停用"}
			onClick={(e) => {
				e.stopPropagation();
				onChange(!provider.enabled);
			}}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
				provider.enabled ? "bg-[#0A84FF]" : "bg-neutral-700/80"
			}`}
		>
			<span
				className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] ${
					provider.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
				}`}
			/>
		</button>
	);
}

function TestResultLine({ test }: { test: TestStatus | undefined }) {
	if (!test) return null;
	if (test.state === "testing") {
		return (
			<div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border-divider)] pt-2 text-[11px] text-neutral-400">
				<Loader2 className="h-3 w-3 animate-spin" />
				正在连接…
			</div>
		);
	}
	const { ok, latencyMs, detail } = test.result;
	return (
		<div
			className={`mt-2 flex items-center gap-1.5 border-t border-[var(--border-divider)] pt-2 text-[11px] ${
				ok ? "text-emerald-400" : "text-rose-400"
			}`}
		>
			{ok ? (
				<CircleCheck className="h-3 w-3 shrink-0" />
			) : (
				<CircleX className="h-3 w-3 shrink-0" />
			)}
			<span className="truncate">
				{detail}（<span className="tabular-nums font-mono">{latencyMs}ms</span>）
			</span>
		</div>
	);
}
