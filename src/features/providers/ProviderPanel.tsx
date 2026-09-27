import { useEffect, useMemo, useState } from "react";
import {
	Activity,
	CircleCheck,
	CircleX,
	ClipboardCopy,
	FileInput,
	Loader2,
	LogIn,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import type { OmpProviderInfo, ProviderConfig } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { getOmpAuthBadge } from "./ompBadge";
import { OauthLoginDialog } from "./OauthLoginDialog";
import { API_LABELS, presetById } from "./presets";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { useProviders, type TestStatus } from "./store";
const PRIVACY_NOTE =
	"密钥使用 macOS 钥匙串加密后存于 ~/.omp-workspace/env/keys.env，明文仅在内存中出现，不会写入数据库或日志。";

export function ProviderPanel() {
	const providers = useProviders((s) => s.providers);
	const loaded = useProviders((s) => s.loaded);
	const error = useProviders((s) => s.error);
	const load = useProviders((s) => s.load);
	const ompProviders = useProviders((s) => s.ompProviders);
	const ompLoaded = useProviders((s) => s.ompLoaded);
	const ompError = useProviders((s) => s.ompError);
	const loadOmp = useProviders((s) => s.loadOmp);
	const exportEnvText = useProviders((s) => s.exportEnvText);
	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);
	const [oauthDialogOpen, setOauthDialogOpen] = useState(false);

	const workbenchSlugs = useMemo(
		() => new Set(providers.map((p) => p.slug)),
		[providers],
	);

	useEffect(() => {
		void load();
	}, [load]);

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

	return (
		<div className="space-y-8">
			{/* Section 1: OMP 已配置的 Provider */}
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-neutral-100">
							OMP 已配置的 Provider
						</h2>
						<p className="mt-0.5 text-xs text-neutral-400">
							来自 ~/.omp/agent/models.yml 与 agent.db，对全部会话生效
						</p>
					</div>
					<button
						type="button"
						onClick={() => void loadOmp()}
						title="刷新 OMP 供应商"
						aria-label="刷新 OMP 供应商"
						className="rounded-lg p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>
				</div>

				{ompError && (
					<div
						role="alert"
						className="flex items-center justify-between gap-2 rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300"
					>
						<span className="min-w-0 flex-1 break-words">{ompError}</span>
						<button
							type="button"
							onClick={() => void loadOmp()}
							className="inline-flex items-center gap-1 text-xs text-rose-200 hover:underline shrink-0"
						>
							<RefreshCw className="h-3 w-3" />
							<span>重试</span>
						</button>
					</div>
				)}

				{!ompLoaded && !ompError && (
					<div className="flex items-center justify-center py-6 text-neutral-500">
						<Loader2
							aria-label="加载 OMP 供应商"
							size={16}
							className="animate-spin"
						/>
					</div>
				)}

				{ompLoaded && !ompError && ompProviders.length === 0 && (
					<div className="rounded-xl hairline bg-[var(--well-bg)]/40 py-6 text-center text-xs text-neutral-500">
						未在 OMP 配置中发现 provider
					</div>
				)}

				{ompLoaded && !ompError && ompProviders.length > 0 && (
					<div className="space-y-2">
						{ompProviders.map((item) => (
							<OmpProviderRow
								key={item.id}
								item={item}
								isManagedInWorkbench={workbenchSlugs.has(item.id)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Section 2: 工作台私有供应商 */}
			<div className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-neutral-100">
							工作台私有供应商
						</h2>
						<p className="mt-0.5 text-xs text-neutral-400">
							存储于本地 ~/.omp-workspace/providers.json，密钥加密存储
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
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
					</div>
				</div>

				{error && (
					<div
						role="alert"
						className="flex items-center gap-2 text-xs text-rose-400"
					>
						<span className="min-w-0 flex-1 break-words">{error}</span>
						<button
							type="button"
							onClick={() => void load()}
							title="重新加载"
							aria-label="重新加载供应商"
							className="rounded p-1 hover:bg-neutral-800"
						>
							<RefreshCw size={14} />
						</button>
					</div>
				)}
				{!loaded && !error && (
					<Loader2
						aria-label="加载供应商"
						size={16}
						className="animate-spin text-neutral-500"
					/>
				)}
				{loaded && !error && providers.length === 0 ? (
					<div className="rounded-xl hairline bg-[var(--well-bg)]/40 py-6 text-center">
						<div className="text-xs text-neutral-400">
							暂无私有供应商配置
						</div>
					</div>
				) : (
					<div className="space-y-2">
						{providers.map((provider) => (
							<ProviderRow
								key={provider.id}
								provider={provider}
								onEdit={() => setDialog({ mode: "edit", provider })}
							/>
						))}
					</div>
				)}
			</div>

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

function OmpProviderRow({
	item,
	isManagedInWorkbench,
}: {
	item: OmpProviderInfo;
	isManagedInWorkbench: boolean;
}) {
	const authBadge = getOmpAuthBadge(item);
	const displayedModels = item.modelIds.slice(0, 6);
	const remainingModelsCount = item.modelIds.length - displayedModels.length;

	return (
		<div className="rounded-xl hairline bg-[var(--well-bg)] p-3 space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2 min-w-0">
					<span className="text-xs font-semibold text-neutral-100 font-mono">
						{item.id}
					</span>
					{item.sources.map((src) => (
						<span
							key={src}
							className="rounded px-1.5 py-0.5 text-[10px] font-mono text-neutral-400 bg-neutral-800/80"
						>
							{src}
						</span>
					))}
				</div>

				<div className="flex flex-wrap items-center gap-1.5 shrink-0">
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
							<span className="text-indigo-400/80 text-[10px] max-w-[140px] truncate">
								· {authBadge.accountSuffix}
							</span>
						)}
					</span>

					{isManagedInWorkbench && (
						<span
							title="工作台私有供应商中已存在相同标识的配置"
							className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-sky-950/40 text-sky-300 border border-sky-700/40"
						>
							工作台已托管
						</span>
					)}
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
				{item.baseUrl && (
					<span
						className="font-mono text-neutral-400 truncate max-w-[280px]"
						title={item.baseUrl}
					>
						{item.baseUrl}
					</span>
				)}
				{item.baseUrl &&
					(item.modelIds.length > 0 || item.usedInRoles.length > 0) && (
						<span className="text-neutral-600">·</span>
					)}

				{item.modelIds.length > 0 && (
					<div className="flex flex-wrap items-center gap-1">
						<span className="text-neutral-500">
							{item.modelIds.length} 个模型:
						</span>
						{displayedModels.map((m) => (
							<span
								key={m}
								className="rounded bg-neutral-800/60 px-1 py-0.5 font-mono text-[10px] text-neutral-300"
							>
								{m}
							</span>
						))}
						{remainingModelsCount > 0 && (
							<span className="rounded bg-neutral-800/40 px-1 py-0.5 font-mono text-[10px] text-neutral-500">
								+{remainingModelsCount}
							</span>
						)}
					</div>
				)}

				{item.usedInRoles.length > 0 && (
					<>
						{(item.baseUrl || item.modelIds.length > 0) && (
							<span className="text-neutral-600">·</span>
						)}
						<span className="text-neutral-400">
							角色:{" "}
							<span className="text-neutral-300">
								{item.usedInRoles.join(", ")}
							</span>
						</span>
					</>
				)}
			</div>
		</div>
	);
}

function ProviderRow({
	provider,
	onEdit,
}: {
	provider: ProviderConfig;
	onEdit: () => void;
}) {
	const setEnabled = useProviders((s) => s.setEnabled);
	const remove = useProviders((s) => s.remove);
	const runTest = useProviders((s) => s.runTest);
	const test = useProviders((s) => s.tests[provider.id]);

	const preset = presetById(provider.presetId);
	const color = preset?.color ?? "#f59e0b";

	const handleDelete = async () => {
		const ok = await confirmDialog(
			`删除供应商「${provider.name}」？其加密密钥也会从密钥库中移除。`,
			{ title: "删除供应商", danger: true, okLabel: "删除" },
		);
		if (!ok) return;
		try {
			await remove(provider.id);
			toast.success("已删除");
		} catch (err) {
			toast.error(`删除失败: ${errMsg(err)}`);
		}
	};

	return (
		<div className="rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
						<span className="text-xs font-semibold text-neutral-100">
							{provider.name}
						</span>
						<span className="rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400">
							{API_LABELS[provider.api]}
						</span>
						{provider.defaultModel && (
							<span className="rounded-md bg-[var(--bg-active-fill)] px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
								{provider.defaultModel}
							</span>
						)}
					</div>
					<div className="mt-1 truncate font-mono text-[11px] text-neutral-500">
						{provider.baseUrl}
					</div>
					<div className="mt-1 text-[11px]">
						{provider.hasKey ? (
							<span className="text-emerald-400">
								已配置{provider.keyHint ? ` (…${provider.keyHint})` : ""}
							</span>
						) : (
							<span className="text-neutral-500">
								{provider.api === "ollama" ? "本地引擎，无需密钥" : "未配置密钥"}
							</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => void runTest(provider.id)}
						disabled={test?.state === "testing"}
						title="测试连接"
						aria-label={`测试 ${provider.name} 连接`}
						className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-white active:scale-95 transition-all disabled:opacity-40"
					>
						{test?.state === "testing" ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
					</button>
					<button
						type="button"
						onClick={onEdit}
						className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						title="编辑"
					>
						<Pencil className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={() => void handleDelete()}
						className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-400 hover:bg-rose-950/40 hover:text-rose-300 active:scale-95 transition-all"
						title="删除"
					>
						<Trash2 className="h-3 w-3" />
					</button>
					<EnabledToggle
						provider={provider}
						onChange={(v) => void setEnabled(provider.id, v).catch((err) => toast.error(`更新失败: ${errMsg(err)}`))}
					/>
				</div>
			</div>
			<TestResultLine test={test} />
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
			onClick={() => onChange(!provider.enabled)}
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
