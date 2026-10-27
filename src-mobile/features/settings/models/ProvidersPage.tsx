import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";
import { Spinner } from "../../../ui/Spinner";
import { hasKey, keyLabel, providerDiffRows, providerSaveBody, type ProviderRow } from "./logic";
import { Badge, Btn, ConfirmDiffSheet, ErrorBox, SettingsPageFrame, useLoader } from "./shared";

interface TestResult {
	ok: boolean;
	latencyMs?: number;
	detail?: string;
}

function ProviderCard({ row, onSaved }: { row: ProviderRow; onSaved: () => void }) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState(row.baseUrl ?? "");
	const [key, setKey] = useState("");
	const [reveal, setReveal] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);
	const [test, setTest] = useState<TestResult | null>(null);
	const [testError, setTestError] = useState<string | null>(null);

	const custom = row.origin === "custom";
	const rows = providerDiffRows(row, url, key);
	const dirty = providerSaveBody(row, url, key) != null;

	const cancel = () => {
		setUrl(row.baseUrl ?? "");
		setKey("");
		setReveal(false);
		setConfirming(false);
		setSaveError(null);
	};

	const runTest = async () => {
		setTesting(true);
		setTest(null);
		setTestError(null);
		try {
			const r = await api<{ result?: TestResult }>("POST", "/left/providers/test", { id: row.id });
			setTest(r.result ?? { ok: true });
		} catch (e) {
			setTestError(errorMessage(e, "测试失败"));
		} finally {
			setTesting(false);
		}
	};

	const save = async () => {
		const body = providerSaveBody(row, url, key);
		if (!body) return;
		setBusy(true);
		setSaveError(null);
		try {
			await api("POST", "/left/providers/save", body);
			toast(`供应商「${row.displayName || row.id}」已更新`, { kind: "success" });
			setKey("");
			setReveal(false);
			setConfirming(false);
			onSaved();
		} catch (e) {
			setSaveError(errorMessage(e, "保存失败"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="border-b border-m-border">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
			>
				<span className="min-w-0 flex-1">
					<span className="block break-words text-m-md text-m-text">{row.displayName || row.id}</span>
					<span className="block break-all text-m-xs text-m-text-3">
						{row.api || "—"} · {row.models?.length ?? 0} 个模型
					</span>
				</span>
				<Badge tone={hasKey(row.key?.kind) ? "accent" : "neutral"}>{keyLabel(row.key?.kind)}</Badge>
			</button>
			{open && (
				<div className="flex flex-col gap-3 bg-m-surface px-4 pt-3 pb-4">
					<label className="flex flex-col gap-1">
						<span className="text-m-xs text-m-text-2">Base URL 接口地址</span>
						<input
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							disabled={!custom}
							placeholder="https://api.example.com/v1"
							inputMode="url"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="min-h-11 rounded-m-md border border-m-border bg-m-bg px-3 font-m-mono text-m-sm text-m-text disabled:opacity-60"
						/>
						{!custom && <span className="text-m-xs text-m-text-3">内置或覆盖类供应商的地址不能在手机上修改</span>}
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-m-xs text-m-text-2">API Key 密钥</span>
						<span className="flex items-center gap-2">
							<input
								type={reveal ? "text" : "password"}
								value={key}
								onChange={(e) => setKey(e.target.value)}
								placeholder={hasKey(row.key?.kind) ? "已配置，输入新密钥以覆盖" : "请输入 API Key"}
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
								className="min-h-11 min-w-0 flex-1 rounded-m-md border border-m-border bg-m-bg px-3 font-m-mono text-m-sm text-m-text"
							/>
							<button
								type="button"
								aria-label={reveal ? "隐藏密钥" : "显示密钥"}
								aria-pressed={reveal}
								onClick={() => setReveal((r) => !r)}
								className="flex min-h-11 min-w-11 items-center justify-center rounded-m-md border border-m-border bg-m-surface-2 text-m-text"
							>
								{reveal ? <EyeOff size={18} /> : <Eye size={18} />}
							</button>
						</span>
						<span className="text-m-xs text-m-text-3">保存后不会再显示密钥；留空则保持不变</span>
					</label>

					{testing && (
						<div className="flex items-center gap-2 text-m-sm text-m-text-2">
							<Spinner size={16} />
							正在测试连接
						</div>
					)}
					{test && (
						<div
							className={`select-text whitespace-pre-wrap break-words text-m-sm ${test.ok ? "text-m-success" : "text-m-danger"}`}
						>
							{test.ok ? `连通成功（延迟 ${test.latencyMs ?? "—"} ms）` : `连接失败：${test.detail || "未知原因"}`}
							{test.ok && test.detail ? `\n${test.detail}` : ""}
						</div>
					)}
					{testError && <ErrorBox title="测试失败" message={testError} />}

					<div className="flex flex-wrap gap-2">
						<Btn onClick={runTest} disabled={testing || row.testable === false}>
							测试连接
						</Btn>
						<div className="flex-1" />
						<Btn onClick={cancel} disabled={!dirty}>
							取消
						</Btn>
						<Btn kind="primary" onClick={() => setConfirming(true)} disabled={!dirty}>
							保存更改
						</Btn>
					</div>
				</div>
			)}
			<ConfirmDiffSheet
				open={confirming}
				title={`确认修改 · ${row.displayName || row.id}`}
				rows={rows}
				busy={busy}
				error={saveError}
				onCancel={() => {
					setConfirming(false);
					setSaveError(null);
				}}
				onConfirm={save}
			/>
		</div>
	);
}

export function SettingsProvidersPage() {
	const { data, error, loading, reload } = useLoader<{ providers?: ProviderRow[] }>(() =>
		api("GET", "/left/providers"),
	);
	const list = data?.providers ?? [];
	return (
		<SettingsPageFrame title="模型与供应商管理" loading={loading && !data} error={error} onRetry={reload}>
			{data && list.length === 0 && <div className="p-6 text-center text-m-sm text-m-text-3">未配置任何供应商</div>}
			{list.map((p) => (
				<ProviderCard key={`${p.id}:${p.baseUrl ?? ""}:${p.key?.kind ?? ""}`} row={p} onSaved={reload} />
			))}
		</SettingsPageFrame>
	);
}
