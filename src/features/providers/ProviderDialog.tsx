import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Eye, EyeOff, FolderOpen, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import type { DiscoveredModel, KeyMode, ProviderRow } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { providerFetchModels, providerReadEnvFile } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { applyContextWindowsOnSave } from "./contextWindowOnSave";
import { planEnvImport } from "./envImport";
import { maskKey } from "./envparse";
import { insecureHttpWarning } from "./httpWarning";
import { KeyModeRadio } from "./KeyModeRadio";
import { ModelPickerModal } from "./ModelPickerModal";
import { type ModelRow, modelEntriesToRows, rowsToModelEntries } from "./modelEntry";
import { KNOWN_APIS, PROVIDER_PRESETS } from "./presets";
import { useProviders } from "./store";

export type ProviderDialogTarget =
	| { mode: "add" }
	| { mode: "edit"; row: ProviderRow }
	| { mode: "import" };

interface Props {
	target: ProviderDialogTarget;
	onClose: () => void;
}

const OTHER_API = "__other__";
const blankModelRow = (): ModelRow => ({ id: "", name: null, contextWindow: "", maxTokens: "" });

const inputCls =
	"mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const cellCls =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const labelCls = "block text-xs font-medium text-neutral-200";
const hintCls = "mt-0.5 text-[11px] text-neutral-400";

export function ProviderDialog({ target, onClose }: Props) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const rows = useProviders((s) => s.rows);
	const upsert = useProviders((s) => s.upsert);
	const setKey = useProviders((s) => s.setKey);

	const editing = target.mode === "edit" ? target.row : null;
	const isImport = target.mode === "import";

	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [id, setId] = useState(editing?.id ?? "");
	const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
	const initialApi = editing?.api ?? "openai-completions";
	const isKnownApi = KNOWN_APIS.some((a) => a.value === initialApi);
	const [apiChoice, setApiChoice] = useState(isKnownApi ? initialApi : OTHER_API);
	const [apiOther, setApiOther] = useState(isKnownApi ? "" : initialApi);
	const [apiKey, setApiKey] = useState("");
	const [keyMode, setKeyMode] = useState<KeyMode>(
		editing?.key.kind === "encrypted" ? "encrypted" : "plaintext",
	);
	const [modelRows, setModelRows] = useState<ModelRow[]>(() => {
		const initial = modelEntriesToRows(editing?.models ?? []);
		return initial.length > 0 ? initial : [blankModelRow()];
	});
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	// .env import state.
	const [pasteText, setPasteText] = useState("");
	const [importMode, setImportMode] = useState<KeyMode>("encrypted");
	const [importing, setImporting] = useState(false);
	const [envPath, setEnvPath] = useState("");
	const [readingFile, setReadingFile] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [dragOver, setDragOver] = useState(false);

	// Model discovery state.
	const [fetchingModels, setFetchingModels] = useState(false);
	const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);

	const api = apiChoice === OTHER_API ? apiOther.trim() : apiChoice;

	const isDirty = useMemo(() => {
		if (isImport) return pasteText.trim().length > 0;
		const entries = rowsToModelEntries(modelRows);
		if (editing) {
			return (
				id !== editing.id ||
				baseUrl !== (editing.baseUrl ?? "") ||
				api !== (editing.api ?? "") ||
				apiKey.length > 0 ||
				JSON.stringify(entries) !== JSON.stringify(editing.models)
			);
		}
		return (
			selectedPresetId !== null ||
			id.length > 0 ||
			baseUrl.length > 0 ||
			apiKey.length > 0 ||
			api !== "openai-completions" ||
			entries.length > 0
		);
	}, [isImport, pasteText, editing, id, baseUrl, api, apiKey, modelRows, selectedPresetId]);

	const isClosingRef = useRef(false);
	const handleDismiss = useCallback(async () => {
		if (isClosingRef.current) return;
		if (isDirty) {
			isClosingRef.current = true;
			try {
				const ok = await confirmDialog("当前有未保存的修改，确定要放弃吗？", {
					danger: true,
					okLabel: "放弃修改",
				});
				if (!ok) {
					isClosingRef.current = false;
					return;
				}
			} catch {
				isClosingRef.current = false;
				return;
			}
		}
		onClose();
	}, [isDirty, onClose]);

	useEscapeKey(handleDismiss);
	useEffect(() => {
		const previous = document.activeElement;
		(
			dialogRef.current?.querySelector<HTMLElement>("input, textarea") ??
			dialogRef.current?.querySelector<HTMLElement>("button")
		)?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);

	const uniqueId = (base: string): string => {
		let next = base;
		for (let i = 2; rows.some((r) => r.id === next); i++) next = `${base}-${i}`;
		return next;
	};

	const applyPreset = (presetId: string) => {
		const p = PROVIDER_PRESETS.find((x) => x.id === presetId);
		setSelectedPresetId(presetId);
		if (!p) return;
		setId(p.id === "custom" ? "" : uniqueId(p.id));
		setBaseUrl(p.baseUrl);
		const known = KNOWN_APIS.some((a) => a.value === p.api);
		setApiChoice(known ? p.api : OTHER_API);
		setApiOther(known ? "" : p.api);
		const preset = modelEntriesToRows(p.models);
		setModelRows(preset.length > 0 ? preset : [blankModelRow()]);
	};

	const handleModelRowChange = (index: number, field: keyof ModelRow, value: string) => {
		setModelRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
	};

	const handleFetchModels = async () => {
		const trimmedUrl = baseUrl.trim();
		if (!trimmedUrl) {
			toast.error("请先填写地址");
			return;
		}
		if (!api) {
			toast.error("请先填写协议");
			return;
		}
		setFetchingModels(true);
		try {
			const models = await providerFetchModels(
				trimmedUrl,
				api,
				apiKey.trim() || null,
				editing?.id ?? null,
			);
			setDiscoveredModels(models);
		} catch (err) {
			toast.error(`获取模型失败：${errMsg(err)}`);
		} finally {
			setFetchingModels(false);
		}
	};

	const replaceModelRows = (selectedIds: string[], append: boolean) => {
		const fresh = selectedIds.map((mid) => ({ ...blankModelRow(), id: mid }));
		setModelRows((prev) => {
			if (!append) return fresh;
			const existing = new Set(prev.map((r) => r.id.trim()).filter(Boolean));
			return [...prev, ...fresh.filter((r) => !existing.has(r.id))];
		});
		setDiscoveredModels(null);
		if (formError) setFormError(null);
	};

	const handleSave = async () => {
		setFormError(null);
		const newId = id.trim();
		const url = baseUrl.trim();
		const missing: string[] = [];
		if (!newId) missing.push("名称");
		if (!url) missing.push("地址");
		if (!api) missing.push("协议");
		if (missing.length > 0) {
			setFormError(`请填写${missing.join("、")}`);
			return;
		}
		if (rows.some((r) => r.id === newId && r.id !== editing?.id)) {
			setFormError(`已有名为「${newId}」的供应商，请换一个名称`);
			return;
		}
		const models = rowsToModelEntries(modelRows);
		if (models.length === 0) {
			setFormError("请至少填写一个模型 ID，才能在 OMP 中选择");
			return;
		}
		setSaving(true);
		try {
			const { config, count } = await applyContextWindowsOnSave(
				editing ? { models: editing.models } : null,
				{ models },
			);
			const key = apiKey.trim();
			await upsert(
				{
					originalId: editing?.id ?? null,
					id: newId,
					displayName: editing?.displayName ?? null,
					baseUrl: url,
					api,
					models: config.models,
				},
				key || null,
				keyMode,
			);
			toast.success(key && keyMode === "encrypted" ? "已保存，密钥已加密" : "已保存");
			if (count > 0) toast.success(`按规则/目录为 ${count} 个模型设置了窗口`);
			onClose();
		} catch (err) {
			setFormError(errMsg(err));
		} finally {
			setSaving(false);
		}
	};

	// ---- .env import ----

	const importPlan = useMemo(() => planEnvImport(pasteText, rows), [pasteText, rows]);
	const importable = importPlan.filter((item) => item.kind !== "unknown").length;

	const handleImport = async () => {
		setImporting(true);
		let count = 0;
		try {
			for (const item of importPlan) {
				if (item.kind === "unknown") continue;
				if (item.kind === "setKey") {
					await setKey(item.row.id, item.entry.value, importMode);
				} else {
					const { config } = await applyContextWindowsOnSave(null, { models: item.preset.models });
					await upsert(
						{
							originalId: null,
							id: item.preset.id,
							displayName: null,
							baseUrl: item.preset.baseUrl,
							api: item.preset.api,
							models: config.models,
						},
						item.entry.value,
						importMode,
					);
				}
				count++;
			}
			toast.success(
				`已导入 ${count} 个供应商密钥（${importMode === "encrypted" ? "加密保存" : "明文写入 OMP 配置"}）`,
			);
			onClose();
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
			setImporting(false);
		}
	};

	const loadEnvFile = useCallback(async (path: string) => {
		const p = path.trim();
		if (!p) return;
		setReadingFile(true);
		setFileError(null);
		try {
			setPasteText(await providerReadEnvFile(p));
		} catch (err) {
			setFileError(errMsg(err));
		} finally {
			setReadingFile(false);
		}
	}, []);

	const handlePickFile = async () => {
		try {
			let defaultPath: string | undefined;
			try {
				defaultPath = await homeDir();
			} catch {
				defaultPath = undefined;
			}
			const selected = await openFileDialog({
				directory: false,
				multiple: false,
				title: "选择 .env 文件",
				defaultPath,
			});
			if (selected && typeof selected === "string") {
				setEnvPath(selected);
				await loadEnvFile(selected);
			}
		} catch (err) {
			setFileError(errMsg(err));
		}
	};

	useEffect(() => {
		if (!isImport) return;
		let disposed = false;
		let unlisten: (() => void) | null = null;
		getCurrentWebview()
			.onDragDropEvent((event) => {
				const p = event.payload;
				if (p.type === "enter" || p.type === "over") {
					setDragOver(true);
				} else if (p.type === "leave") {
					setDragOver(false);
				} else if (p.type === "drop") {
					setDragOver(false);
					const first = p.paths[0];
					if (first) {
						setEnvPath(first);
						void loadEnvFile(first);
					}
				}
			})
			.then((fn) => {
				if (disposed) fn();
				else unlisten = fn;
			})
			.catch(() => {});
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [isImport, loadEnvFile]);

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-md"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) void handleDismiss();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-dialog-title"
				onKeyDown={(e) => {
					if (e.key !== "Tab") return;
					const controls = Array.from(
						e.currentTarget.querySelectorAll<HTMLElement>(
							'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
						),
					).filter((control) => control.getClientRects().length > 0);
					const first = controls[0];
					const last = controls[controls.length - 1];
					if (e.shiftKey && document.activeElement === first) {
						e.preventDefault();
						last?.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first?.focus();
					}
				}}
				className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-[var(--bg-panel)] shadow-apple-modal hairline"
			>
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] px-4 py-3">
					<div id="provider-dialog-title" className="text-xs font-semibold tracking-[-0.018em] text-neutral-100">
						{editing ? "编辑供应商" : isImport ? "从 .env 文件导入" : "添加供应商"}
					</div>
					<button
						type="button"
						onClick={() => void handleDismiss()}
						aria-label="关闭"
						className="rounded-md p-1 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{isImport ? (
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						<div
							className={
								dragOver
									? "rounded-lg border border-dashed border-[var(--accent)] p-2"
									: "rounded-lg border border-dashed border-transparent p-2"
							}
						>
							<div className={labelCls}>从文件读取</div>
							<div className="mt-1.5 flex items-center gap-1.5">
								<input
									type="text"
									value={envPath}
									onChange={(e) => setEnvPath(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !isComposing(e)) {
											e.preventDefault();
											void loadEnvFile(envPath);
										}
									}}
									placeholder="~/project/.env"
									aria-label=".env 文件路径"
									spellCheck={false}
									className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => void loadEnvFile(envPath)}
									disabled={readingFile || envPath.trim() === ""}
									className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] disabled:opacity-40"
								>
									{readingFile && <Loader2 className="h-3 w-3 animate-spin" />}
									<span>读取</span>
								</button>
								<button
									type="button"
									onClick={() => void handlePickFile()}
									className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)]"
								>
									<FolderOpen className="h-3 w-3" />
									<span>选择文件</span>
								</button>
							</div>
							<div className={hintCls}>
								看不到 .env？在选择窗口按 ⌘⇧.（Command + Shift + 句号）显示隐藏文件，或把文件拖进来 / 粘贴路径
							</div>
							{fileError && (
								<div className="mt-1 select-text whitespace-pre-wrap break-words text-[11px] text-red-400">
									{fileError}
								</div>
							)}
						</div>
						<div>
							<label htmlFor="provider-import" className={labelCls}>
								粘贴 .env 内容
							</label>
							<div className={hintCls}>
								支持多行，格式 <code className="font-mono">ANTHROPIC_API_KEY=sk-ant-xxx</code>；
								能对上已有供应商或预设的变量会自动匹配
							</div>
							<textarea
								id="provider-import"
								value={pasteText}
								onChange={(e) => setPasteText(e.target.value)}
								rows={6}
								spellCheck={false}
								autoComplete="off"
								className={`${inputCls} font-mono`}
								placeholder={"ANTHROPIC_API_KEY=sk-ant-xxx\nOPENAI_API_KEY=sk-xxx"}
							/>
						</div>

						{importPlan.length > 0 && (
							<div className="space-y-1.5">
								<div className="text-xs font-medium text-neutral-300">预览（{importable} 个可导入）</div>
								{importPlan.map((item) => (
									<div
										key={item.entry.key}
										className="flex items-center justify-between rounded-lg bg-neutral-950 px-3 py-2 text-xs"
									>
										<span className="font-mono text-neutral-300">{item.entry.key}</span>
										<span className="flex items-center gap-2 text-[11px]">
											<span className="font-mono text-neutral-500">{maskKey(item.entry.value)}</span>
											{item.kind === "unknown" && <span className="text-neutral-500">未识别，跳过</span>}
											{item.kind === "create" && (
												<span className="text-emerald-400">新建 {item.preset.name}</span>
											)}
											{item.kind === "setKey" && (
												<span className="text-amber-400">更新 {item.row.displayName ?? item.row.id} 的密钥</span>
											)}
										</span>
									</div>
								))}
							</div>
						)}
						<KeyModeRadio name="import-key-mode" value={importMode} onChange={setImportMode} />
					</div>
				) : (
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						{!editing && (
							<div>
								<div className={labelCls}>从预设开始</div>
								<div className="mt-2 flex flex-wrap gap-1.5">
									{PROVIDER_PRESETS.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() => applyPreset(p.id)}
											className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all active:scale-95 ${
												selectedPresetId === p.id
													? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] font-medium text-[var(--accent)]"
													: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
											}`}
										>
											<span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
											{p.name}
										</button>
									))}
								</div>
							</div>
						)}

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label htmlFor="provider-name" className={labelCls}>
									名称
								</label>
								<input
									id="provider-name"
									type="text"
									value={id}
									onChange={(e) => setId(e.target.value)}
									spellCheck={false}
									className={`${inputCls} font-mono`}
									placeholder="例如: my-gateway"
								/>
								<div className={hintCls}>就是 OMP 里的供应商名，选模型时显示为 名称/模型 ID</div>
							</div>
							<div>
								<label htmlFor="provider-url" className={labelCls}>
									地址
								</label>
								<input
									id="provider-url"
									type="text"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									className={`${inputCls} font-mono`}
									placeholder="https://api.example.com/v1"
								/>
								{insecureHttpWarning(baseUrl) && (
									<p
										role="status"
										className="mt-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300"
									>
										{insecureHttpWarning(baseUrl)}
									</p>
								)}
							</div>
						</div>

						<div>
							<label htmlFor="provider-api" className={labelCls}>
								协议
							</label>
							<NativeSelect
								id="provider-api"
								value={apiChoice}
								onChange={(e) => setApiChoice(e.target.value)}
								containerClassName="mt-1.5"
							>
								{KNOWN_APIS.map((a) => (
									<option key={a.value} value={a.value}>
										{a.label}
									</option>
								))}
								<option value={OTHER_API}>其他 OMP 支持的协议</option>
							</NativeSelect>
							{apiChoice === OTHER_API && (
								<input
									type="text"
									value={apiOther}
									onChange={(e) => setApiOther(e.target.value)}
									aria-label="其他 OMP 支持的协议"
									spellCheck={false}
									className={`${inputCls} font-mono`}
									placeholder="OMP 的 api 字段原文，如 azure-openai-responses"
								/>
							)}
						</div>

						<div>
							<label htmlFor="provider-key" className={labelCls}>
								API 密钥
							</label>
							<div className="relative">
								<input
									id="provider-key"
									type={showKey ? "text" : "password"}
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if (e.key === "Enter" && !saving) void handleSave();
									}}
									autoComplete="new-password"
									className={`${inputCls} pr-9`}
									placeholder={editing ? "留空保持不变" : "sk-xxx"}
								/>
								<button
									type="button"
									onClick={() => setShowKey((value) => !value)}
									title={showKey ? "隐藏密钥" : "显示密钥"}
									aria-label={showKey ? "隐藏密钥" : "显示密钥"}
									className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-neutral-500 transition-all hover:text-neutral-200 active:scale-95"
								>
									{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
								</button>
							</div>
						</div>
						<KeyModeRadio name="provider-key-mode" value={keyMode} onChange={setKeyMode} />

						<div className="border-t border-[var(--border-divider)] pt-3">
							<div className="flex items-center justify-between">
								<span className={labelCls}>模型列表</span>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => void handleFetchModels()}
										disabled={fetchingModels}
										className="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-40"
									>
										{fetchingModels ? (
											<Loader2 className="h-3 w-3 animate-spin" />
										) : (
											<RefreshCw className="h-3 w-3" />
										)}
										<span>获取模型列表</span>
									</button>
									<button
										type="button"
										onClick={() => setModelRows((prev) => [...prev, blankModelRow()])}
										className="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs text-[var(--accent)] transition-all hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] active:scale-95"
									>
										<Plus className="h-3 w-3" />
										<span>添加模型</span>
									</button>
								</div>
							</div>
							<p className={hintCls}>模型 ID 必填；上下文窗口和输出上限留空则用 OMP 默认值。</p>

							<div className="mt-2 space-y-1.5">
								{modelRows.length > 0 && (
									<div className="grid grid-cols-[1fr_88px_88px_28px] gap-2 px-1 text-[11px] font-medium text-neutral-400">
										<span>模型 ID</span>
										<span>上下文窗口</span>
										<span>输出上限</span>
										<span />
									</div>
								)}
								{modelRows.map((row, index) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity while being typed
										key={index}
										className="grid grid-cols-[1fr_88px_88px_28px] items-center gap-2"
									>
										<input
											type="text"
											value={row.id}
											onChange={(e) => handleModelRowChange(index, "id", e.target.value)}
											aria-label={`第 ${index + 1} 个模型 ID`}
											className={cellCls}
											placeholder="例如: gpt-4o"
										/>
										<input
											type="number"
											min={1}
											max={2000000}
											value={row.contextWindow}
											onChange={(e) => handleModelRowChange(index, "contextWindow", e.target.value)}
											aria-label={`第 ${index + 1} 个模型的上下文窗口`}
											className={cellCls}
											placeholder="默认"
										/>
										<input
											type="number"
											min={1}
											max={2000000}
											value={row.maxTokens}
											onChange={(e) => handleModelRowChange(index, "maxTokens", e.target.value)}
											aria-label={`第 ${index + 1} 个模型的输出上限`}
											className={cellCls}
											placeholder="默认"
										/>
										<button
											type="button"
											onClick={() => setModelRows((prev) => prev.filter((_, i) => i !== index))}
											aria-label={`删除第 ${index + 1} 个模型`}
											title="删除模型"
											className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</div>
								))}
								{modelRows.length === 0 && (
									<div className="rounded-lg hairline border-dashed border-neutral-700 p-3 text-center text-xs text-neutral-500">
										暂无模型，点击右上角「添加模型」
									</div>
								)}
							</div>
						</div>
					</div>
				)}

				{formError && (
					<div
						role="alert"
						className="mx-4 mb-2 select-text rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300"
					>
						{formError}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					<button
						type="button"
						onClick={() => void handleDismiss()}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
					>
						取消
					</button>
					{isImport ? (
						<button
							type="button"
							disabled={importable === 0 || importing}
							onClick={() => void handleImport()}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
						>
							{importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>确认导入（{importable}）</span>
						</button>
					) : (
						<button
							type="button"
							disabled={saving}
							onClick={() => void handleSave()}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
						>
							{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>保存</span>
						</button>
					)}
				</div>
			</div>

			{discoveredModels && (
				<ModelPickerModal
					models={discoveredModels}
					existingModelIds={new Set(modelRows.map((r) => r.id.trim()).filter(Boolean))}
					onClose={() => setDiscoveredModels(null)}
					onAppend={(ids) => replaceModelRows(ids, true)}
					onReplace={(ids) => replaceModelRows(ids, false)}
				/>
			)}
		</div>
	);
}
