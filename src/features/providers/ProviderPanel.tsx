import { ChevronDown, ClipboardCopy, FileInput, Loader2, Lock, LogIn, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { SearchInput } from "../../components/SearchInput";
import type { ProviderRow } from "../../lib/contracts";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { SectionHeader } from "../settings/ui";
import { useSettingsNav } from "../settings/settingsNav";
import { openSettingsTarget } from "../settings/settingsTargets";
import { VAULT_PATH, MODELS_YML_PATH } from "./keyState";
import { modelEntryId } from "./modelEntry";
import { OauthLoginDialog } from "./OauthLoginDialog";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { ProviderRowView, ROW_GRID } from "./ProviderRowView";
import { SetKeyDialog } from "./SetKeyDialog";
import { useProviders } from "./store";

const FOOTER_NOTE = `加密的密钥存于 ${VAULT_PATH}，只在使用时解密，不写入数据库或日志；未加密的密钥按 OMP 默认留在 ${MODELS_YML_PATH}。`;

function matchesQuery(row: ProviderRow, q: string): boolean {
	const haystack = [row.id, row.displayName, row.baseUrl, row.api, ...row.models.map(modelEntryId)]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(q);
}

export function ProviderPanel() {
	const rows = useProviders((s) => s.rows);
	const loaded = useProviders((s) => s.loaded);
	const error = useProviders((s) => s.error);
	const load = useProviders((s) => s.load);
	const encryptAll = useProviders((s) => s.encryptAll);
	const exportEnvText = useProviders((s) => s.exportEnvText);

	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [keyDialogId, setKeyDialogId] = useState<string | null>(null);
	const [oauthDialog, setOauthDialog] = useState(false);
	const [query, setQuery] = useState("");
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [encryptingAll, setEncryptingAll] = useState(false);
	const menuBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void load();
	}, [load]);

	// Deep link from the quota sheet: expand the targeted provider row.
	const { focusKey, focusRequest } = useSettingsNav();
	// biome-ignore lint/correctness/useExhaustiveDependencies: focusRequest re-fires the jump for a repeated key
	useEffect(() => {
		if (focusKey?.startsWith("provider:")) setExpandedId(focusKey.slice("provider:".length));
	}, [focusKey, focusRequest]);

	const sorted = useMemo(
		() => [...rows].sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id)),
		[rows],
	);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? sorted.filter((r) => matchesQuery(r, q)) : sorted;
	}, [sorted, query]);

	const encryptedCount = rows.filter((r) => r.key.kind === "encrypted").length;
	const plaintextCount = rows.filter((r) => r.key.kind === "plaintext").length;
	const keyDialogRow = keyDialogId ? rows.find((r) => r.id === keyDialogId) : undefined;

	const handleEncryptAll = async () => {
		setMenuOpen(false);
		setEncryptingAll(true);
		try {
			const results = await encryptAll();
			const failed = results.filter((r) => !r.ok);
			const done = results.length - failed.length;
			if (failed.length === 0) toast.success(`已加密 ${done} 个供应商的密钥`);
			else toast.error(`已加密 ${done} 个，${failed.length} 个失败：${failed[0].id}（${failed[0].error ?? "未知错误"}）`);
		} catch (err) {
			toast.error(`加密失败: ${errMsg(err)}`);
		} finally {
			setEncryptingAll(false);
		}
	};

	const handleExport = async () => {
		setMenuOpen(false);
		try {
			const text = (await exportEnvText()).trim();
			if (!text) {
				toast.info("还没有可导出密钥的供应商");
				return;
			}
			await copyText(text);
			toast.success("已复制全部密钥到剪贴板（内容是明文，注意保密，粘贴后及时清空）");
		} catch (err) {
			toast.error(`导出失败: ${errMsg(err)}`);
		}
	};

	const isLoading = !loaded && !error;
	const menuItemCls =
		"flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-neutral-200 hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:hover:bg-transparent";

	return (
		<div className="space-y-4">
			<div className="space-y-3">
				<SectionHeader
					title="API 供应商"
					description={`共 ${rows.length} 个，其中 ${encryptedCount} 个的密钥已加密。供应商就是提供模型的服务商，开启后新会话就能用它的模型。`}
				/>
				<button
					type="button"
					onClick={() => openSettingsTarget("modelContext")}
					className="flex w-full items-center gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] px-3 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-[var(--bg-hover)]"
				>
					<SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
					<span className="flex-1">按型号批量设置各模型的上下文窗口与自动压缩，到「上下文窗口」页。</span>
					<span className="font-medium text-[var(--accent)]">前往 →</span>
				</button>
				<div className="flex flex-col items-stretch justify-between gap-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-2 shadow-2xs sm:flex-row sm:items-center">
					<SearchInput
						className="min-w-[200px] max-w-sm flex-1"
						value={query}
						onChange={setQuery}
						placeholder="搜索名称、地址、协议或模型"
						ariaLabel="筛选供应商"
					/>
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap">
						<button
							ref={menuBtnRef}
							type="button"
							onClick={() => setMenuOpen((v) => !v)}
							className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							{encryptingAll && <Loader2 className="h-3 w-3 animate-spin" />}
							<span>批量管理密钥</span>
							<ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
						</button>
						{menuOpen && (
							<FloatingLayer
								anchor={menuBtnRef.current}
								placement="bottom-end"
								offset={4}
								layer="popover"
								onDismiss={() => setMenuOpen(false)}
								ignoreRefs={[menuBtnRef]}
								className="w-60 space-y-0.5 rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-1 text-xs shadow-xl"
							>
								<button
									type="button"
									onClick={() => void handleEncryptAll()}
									disabled={plaintextCount === 0 || encryptingAll}
									className={menuItemCls}
								>
									<Lock className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
									<span className="flex-1 whitespace-nowrap font-medium">
										{plaintextCount === 0 ? "已全部加密" : `全部加密（${plaintextCount} 个明文）`}
									</span>
								</button>
								<button
									type="button"
									onClick={() => {
										setMenuOpen(false);
										setDialog({ mode: "import" });
									}}
									className={menuItemCls}
								>
									<FileInput className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
									<span className="flex-1 whitespace-nowrap font-medium">从 .env 文件导入</span>
								</button>
								<button type="button" onClick={() => void handleExport()} className={menuItemCls}>
									<ClipboardCopy className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
									<span className="flex-1">
										<span className="block whitespace-nowrap font-medium">复制全部密钥</span>
										<span className="block text-[10px] text-neutral-400">格式为 名字=密钥，内容是明文，注意保密</span>
									</span>
								</button>
							</FloatingLayer>
						)}
						<button
							type="button"
							onClick={() => setOauthDialog(true)}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							<LogIn className="h-3.5 w-3.5 text-neutral-400" />
							<span>OAuth 登录</span>
						</button>
						<button
							type="button"
							onClick={() => setDialog({ mode: "add" })}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-xs transition-all hover:opacity-90 active:scale-95"
						>
							<Plus className="h-3.5 w-3.5" />
							<span>添加供应商</span>
						</button>
						<button
							type="button"
							onClick={() => void load()}
							title="刷新供应商"
							aria-label="刷新供应商"
							className="rounded-lg p-1.5 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
						>
							<RefreshCw className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>

			{error && (
				<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
					<span className="min-w-0 flex-1 break-words">{error}</span>
					<button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-rose-900/60 px-2.5 py-1 text-xs font-medium text-rose-200 transition-colors hover:bg-rose-800/80">
						<RefreshCw className="h-3 w-3" />
						<span>重试</span>
					</button>
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-6 text-neutral-500">
					<Loader2 aria-label="加载供应商" size={16} className="animate-spin" />
				</div>
			)}

			{!isLoading && !error && filtered.length === 0 && (
				<div className="rounded-xl hairline bg-[var(--well-bg)]/40 px-4 py-8 text-center text-xs text-neutral-400">
					{rows.length === 0 ? (
						<div className="space-y-3">
							<p className="text-sm text-neutral-200">还没有配置任何供应商</p>
							<p>添加一个模型服务商（如 Anthropic、OpenAI 或公司网关）并填入 API 密钥，即可开始对话。</p>
							<button
								type="button"
								onClick={() => setDialog({ mode: "add" })}
								className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95"
							>
								<Plus className="h-3.5 w-3.5" />
								<span>添加供应商</span>
							</button>
						</div>
					) : (
						<div className="space-y-2">
							<p>没有匹配「{query.trim()}」的供应商</p>
							<button type="button" onClick={() => setQuery("")} className="rounded-md border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:bg-[var(--bg-hover)] text-[var(--accent)]">
								清除筛选
							</button>
						</div>
					)}
				</div>
			)}

			{!isLoading && !error && filtered.length > 0 && (
				<div className="space-y-1">
					<div className={`${ROW_GRID} px-2.5 text-[11px] text-neutral-500`}>
						<span>供应商（点名称看详情）</span>
						<span className="whitespace-nowrap">密钥（点击可修改）</span>
						<span className="text-right">启用</span>
					</div>
					{filtered.map((row) => (
						<div key={row.id} data-field-id={`provider:${row.id}`}>
							<ProviderRowView
								row={row}
								expanded={expandedId === row.id}
								onToggleExpand={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
								onEdit={() => setDialog({ mode: "edit", row })}
								onSetKey={() => setKeyDialogId(row.id)}
								onOauth={() => setOauthDialog(true)}
							/>
						</div>
					))}
				</div>
			)}

			<div className="text-[11px] leading-relaxed text-neutral-600">{FOOTER_NOTE}</div>

			{dialog && <ProviderDialog target={dialog} onClose={() => setDialog(null)} />}
			{keyDialogRow && <SetKeyDialog row={keyDialogRow} onClose={() => setKeyDialogId(null)} />}
			{oauthDialog && <OauthLoginDialog onClose={() => setOauthDialog(false)} />}
		</div>
	);
}
