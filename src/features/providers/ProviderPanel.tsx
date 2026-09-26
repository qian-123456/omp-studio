import { useEffect, useState } from "react";
import {
	CircleCheck,
	CircleX,
	ClipboardCopy,
	FileInput,
	Loader2,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import type { ProviderConfig } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { API_LABELS, presetById } from "./presets";
import { ProviderDialog, type ProviderDialogTarget } from "./ProviderDialog";
import { useProviders, type TestStatus } from "./store";

const PRIVACY_NOTE =
	"密钥使用 macOS 钥匙串加密后存于 ~/.omp-workspace/env/keys.env，明文仅在内存中出现，不会写入数据库或日志。";

export function ProviderPanel() {
	const providers = useProviders((s) => s.providers);
	const loaded = useProviders((s) => s.loaded);
	const load = useProviders((s) => s.load);
	const exportEnvText = useProviders((s) => s.exportEnvText);
	const [dialog, setDialog] = useState<ProviderDialogTarget | null>(null);

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
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="text-sm font-semibold text-neutral-100">API 供应商</h2>
					<p className="text-xs text-neutral-500">
						图形化配置模型供应商；密钥加密保存，并自动注入新会话与终端的环境变量
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={() => void handleExport()}
						className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
						title="导出明文 .env 文本，仅复制到剪贴板"
					>
						<ClipboardCopy className="h-3.5 w-3.5" />
						<span>复制 .env</span>
					</button>
					<button
						type="button"
						onClick={() => setDialog({ mode: "import" })}
						className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
					>
						<FileInput className="h-3.5 w-3.5" />
						<span>.env 导入</span>
					</button>
					<button
						type="button"
						onClick={() => setDialog({ mode: "add" })}
						className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400"
					>
						<Plus className="h-3.5 w-3.5" />
						<span>添加供应商</span>
					</button>
				</div>
			</div>

			{loaded && providers.length === 0 ? (
				<div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6 text-center">
					<div className="text-xs text-neutral-300">
						还没有供应商。点击「添加供应商」从预设开始，或粘贴 .env 一键导入。
					</div>
					<div className="text-[11px] text-neutral-500">{PRIVACY_NOTE}</div>
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

			<div className="text-[11px] leading-relaxed text-neutral-600">
				{PRIVACY_NOTE}
			</div>

			{dialog && (
				<ProviderDialog target={dialog} onClose={() => setDialog(null)} />
			)}
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
		<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: color }}
						/>
						<span className="text-xs font-medium text-neutral-100">
							{provider.name}
						</span>
						<span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
							{API_LABELS[provider.api]}
						</span>
						{provider.defaultModel && (
							<span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
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
						className="rounded-lg border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
					>
						{test?.state === "testing" ? "测试中…" : "测试"}
					</button>
					<button
						type="button"
						onClick={onEdit}
						className="rounded-lg border border-neutral-700 p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
						title="编辑"
					>
						<Pencil className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={() => void handleDelete()}
						className="rounded-lg border border-neutral-700 p-1.5 text-neutral-400 hover:bg-rose-950/40 hover:text-rose-300"
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
			aria-checked={provider.enabled}
			title={provider.enabled ? "已启用（新会话注入密钥）" : "已停用"}
			onClick={() => onChange(!provider.enabled)}
			className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
				provider.enabled ? "bg-amber-500" : "bg-neutral-700"
			}`}
		>
			<span
				className={`inline-block h-3.5 w-3.5 transform rounded-full bg-neutral-950 transition ${
					provider.enabled ? "translate-x-4.5" : "translate-x-1"
				}`}
			/>
		</button>
	);
}

function TestResultLine({ test }: { test: TestStatus | undefined }) {
	if (!test) return null;
	if (test.state === "testing") {
		return (
			<div className="mt-2 flex items-center gap-1.5 border-t border-neutral-800/60 pt-2 text-[11px] text-neutral-400">
				<Loader2 className="h-3 w-3 animate-spin" />
				正在连接…
			</div>
		);
	}
	const { ok, latencyMs, detail } = test.result;
	return (
		<div
			className={`mt-2 flex items-center gap-1.5 border-t border-neutral-800/60 pt-2 text-[11px] ${
				ok ? "text-emerald-400" : "text-rose-400"
			}`}
		>
			{ok ? (
				<CircleCheck className="h-3 w-3 shrink-0" />
			) : (
				<CircleX className="h-3 w-3 shrink-0" />
			)}
			<span className="truncate">
				{detail}（{latencyMs}ms）
			</span>
		</div>
	);
}
