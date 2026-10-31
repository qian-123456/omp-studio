import { Activity, Cloud, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { Button, Chip, Field, IconButton, ListGroup, ListRow, Spinner, TextField, toast } from "../../../ui";
import { SettingsSheet } from "../rows";
import { hasKey, keyLabel, providerDiffRows, providerSaveBody, type ProviderRow } from "./logic";
import { ConfirmDiffSheet, ErrorBox, SettingsPageFrame, useLoader } from "./shared";

interface TestResult {
	ok: boolean;
	latencyMs?: number;
	detail?: string;
}

const ICON = { size: 22, strokeWidth: 1.75 } as const;
const providerVersions = new Map<string, number>();
const providerWrites = new Set<string>();

function ProviderItem({ row, onSaved }: { row: ProviderRow; onSaved: () => void }) {
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
	const saving = useRef(false);
	useEffect(() => {
		if (!open) setUrl(row.baseUrl ?? "");
	}, [row.baseUrl, open]);

	const name = row.displayName || row.id;
	const custom = row.origin === "custom";
	const configured = hasKey(row.key?.kind);
	const rows = providerDiffRows(row, url, key);
	const dirty = providerSaveBody(row, url, key) != null;

	const reset = () => {
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
		if (!body || saving.current || providerWrites.has(row.id)) return;
		saving.current = true;
		providerWrites.add(row.id);
		const version = (providerVersions.get(row.id) ?? 0) + 1;
		providerVersions.set(row.id, version);
		setBusy(true);
		setSaveError(null);
		try {
			const previous = await api<{ providers?: ProviderRow[] }>("GET", "/left/providers");
			const before = previous.providers?.find((p) => p.id === row.id);
			if (!before) throw new Error("供应商不存在");
			const result = await api<{ provider?: ProviderRow }>("POST", "/left/providers/save", body);
			toast(`供应商「${name}」已更新`, {
				kind: "success",
				action: !body.api_key && body.base_url && before.baseUrl ? { label: "撤销", onClick: async () => {
					if (providerVersions.get(row.id) !== version || providerWrites.has(row.id)) throw new Error("已有更新的修改，无法撤销旧修改");
					providerWrites.add(row.id);
					setBusy(true);
					try {
						const latest = await api<{ providers?: ProviderRow[] }>("GET", "/left/providers");
						const current = latest.providers?.find((p) => p.id === row.id);
						if (providerVersions.get(row.id) !== version || current?.baseUrl !== (result.provider?.baseUrl ?? body.base_url)) throw new Error("供应商已被修改，未覆盖较新的配置");
						providerVersions.set(row.id, version + 1);
						await api("POST", "/left/providers/save", { id: row.id, base_url: before.baseUrl });
						setUrl(before.baseUrl ?? "");
						onSaved();
						toast("已撤销接口地址修改", { kind: "success" });
					} finally {
						providerWrites.delete(row.id);
						setBusy(false);
					}
				} } : undefined,
			});
			setKey("");
			setReveal(false);
			setConfirming(false);
			setOpen(false);
			onSaved();
		} catch (e) {
			setSaveError(errorMessage(e, "保存失败"));
		} finally {
			providerWrites.delete(row.id);
			saving.current = false;
			setBusy(false);
		}
	};
	const submit = () => {
		const body = providerSaveBody(row, url, key);
		if (!body) return;
		setSaveError(null);
		// Secrets cannot be restored; combined changes need a masked review.
		if (body.api_key || !row.baseUrl) setConfirming(true);
		else void save();
	};

	const status = <Chip tone={configured ? "success" : "neutral"}>{keyLabel(row.key?.kind)}</Chip>;

	return (
		<>
			<ListRow
				icon={<Cloud {...ICON} />}
				title={name}
				subtitle={
					<span className="flex flex-wrap gap-x-1">
						<span className="break-all">{row.api || "—"}</span>
						<span className="whitespace-nowrap">· {row.models?.length ?? 0} 个模型</span>
					</span>
				}
				right={status}
				chevron
				onClick={() => { if (!providerWrites.has(row.id)) setOpen(true); }}
				disabled={busy}
			/>
			<SettingsSheet
				open={open}
				onClose={() => { if (!busy) setOpen(false); }}
				title={name}
				subtitle={row.id !== name ? row.id : undefined}
				footer={
					<div className="flex items-center gap-3">
						<Button
							variant="tonal"
							disabled={busy}
							onClick={() => {
								reset();
								setOpen(false);
							}}
						>
							取消
						</Button>
						<div className="flex-1" />
						<Button variant="primary" onClick={submit} disabled={!dirty} busy={busy}>
							保存更改
						</Button>
					</div>
				}
			>
				<ListGroup>
					<ListRow title="接口类型" right={<span className="text-m-text-2">{row.api || "—"}</span>} />
					<ListRow title="模型数量" right={<span className="text-m-text-2">{row.models?.length ?? 0} 个</span>} />
					<ListRow title="密钥状态" right={status} />
				</ListGroup>

				<div className="flex flex-col gap-5 px-5 pt-5">
					<Field
						label="Base URL 接口地址"
						hint={custom ? undefined : "内置或覆盖类供应商的地址不能在手机上修改"}
					>
						<TextField
							value={url}
							onChange={(e) => { if (!providerWrites.has(row.id)) { providerVersions.set(row.id, (providerVersions.get(row.id) ?? 0) + 1); setUrl(e.target.value); } }}
							disabled={!custom || busy}
							placeholder="https://api.example.com/v1"
							inputMode="url"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="font-m-mono"
						/>
					</Field>
					<Field label="API Key 密钥" hint="保存后不会再显示密钥；留空则保持不变">
						<span className="relative block">
							<TextField
								type={reveal ? "text" : "password"}
								value={key}
								onChange={(e) => { if (!providerWrites.has(row.id)) { providerVersions.set(row.id, (providerVersions.get(row.id) ?? 0) + 1); setKey(e.target.value); } }}
								disabled={busy}
								placeholder={configured ? "已配置，输入新密钥以覆盖" : "请输入 API Key"}
								autoComplete="off"
								autoCapitalize="off"
								autoCorrect="off"
								spellCheck={false}
								className="pr-14 font-m-mono"
							/>
							<span className="absolute inset-y-0 right-1 flex items-center">
								<IconButton
									variant="plain"
									icon={reveal ? <EyeOff size={20} strokeWidth={1.75} /> : <Eye size={20} strokeWidth={1.75} />}
									label={reveal ? "隐藏密钥" : "显示密钥"}
									pressed={reveal}
									onClick={() => setReveal((r) => !r)}
								/>
							</span>
						</span>
					</Field>
				</div>
				{saveError && !confirming && <div className="px-4 pt-3"><ErrorBox title="保存失败" message={saveError} /></div>}

				<ListGroup title="连接测试">
					<ListRow
						icon={<Activity {...ICON} />}
						title={testing ? "正在测试连接" : "测试连接"}
						subtitle={row.testable === false ? "此供应商不支持连接测试" : undefined}
						right={testing ? <Spinner size={18} /> : undefined}
						chevron={false}
						disabled={testing || row.testable === false}
						onClick={() => void runTest()}
					/>
					{test && (
						<div
							className={`m-selectable px-4 py-3 text-m-sm whitespace-pre-wrap break-words ${
								test.ok ? "text-m-success" : "text-m-danger"
							}`}
						>
							{test.ok ? `连通成功（延迟 ${test.latencyMs ?? "—"} ms）` : `连接失败：${test.detail || "未知原因"}`}
							{test.ok && test.detail ? `\n${test.detail}` : ""}
						</div>
					)}
				</ListGroup>
				{testError && (
					<div className="px-4 pt-2">
						<ErrorBox title="测试失败" message={testError} />
					</div>
				)}
			</SettingsSheet>
			<ConfirmDiffSheet
				open={confirming}
				title={`确认修改 · ${name}`}
				rows={rows}
				busy={busy}
				error={saveError}
				onCancel={() => {
					if (busy) return;
					setConfirming(false);
					setSaveError(null);
				}}
				onConfirm={save}
			/>
		</>
	);
}

export function SettingsProvidersPage() {
	const { data, error, loading, reload } = useLoader<{ providers?: ProviderRow[] }>(() => api("GET", "/left/providers"));
	const list = data?.providers ?? [];
	return (
		<SettingsPageFrame title="模型与供应商" loading={loading && !data} error={error} onRetry={reload}>
			{data && list.length === 0 && <div className="p-8 text-center text-m-sm text-m-text-3">未配置任何供应商</div>}
			{list.length > 0 && (
				<ListGroup title="供应商" note="点按供应商可修改地址和密钥、测试连接。">
					{list.map((p) => (
						<ProviderItem key={p.id} row={p} onSaved={reload} />
					))}
				</ListGroup>
			)}
		</SettingsPageFrame>
	);
}
