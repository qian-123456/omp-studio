import { ChevronDown, Eye, EyeOff, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { NativeSelect } from "../../components/NativeSelect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProviderApi, ProviderConfig } from "../../lib/contracts";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { maskKey, parseEnvText, slugify } from "./envparse";
import { API_LABELS, matchPresetByEnvVar, PROVIDER_PRESETS } from "./presets";
import { useProviders } from "./store";
import {
	type ModelRow,
	modelEntriesToRows,
	rowsToModelEntries,
} from "./modelEntry";
import { ModelPickerModal } from "./ModelPickerModal";
import type { DiscoveredModel } from "../../lib/contracts";
import { providerFetchModels } from "../../lib/ipc";
import { applyContextWindowsOnSave } from "./contextWindowOnSave";

export type ProviderDialogTarget =
	| { mode: "add" }
	| { mode: "edit"; provider: ProviderConfig }
	| { mode: "import" };

interface Props {
	target: ProviderDialogTarget;
	onClose: () => void;
}

function blankConfig(): ProviderConfig {
	return {
		id: "",
		name: "",
		slug: "",
		presetId: null,
		baseUrl: "",
		api: "openai_completions",
		envVar: "",
		models: [],
		defaultModel: null,
		defaultContextWindow: null,
		defaultMaxTokens: null,
		enabled: true,
		sort: 0,
		hasKey: false,
		keyHint: null,
		notes: null,
		createdAt: "",
		updatedAt: "",
	};
}

const inputCls =
	"mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const labelCls = "block text-xs font-medium text-neutral-200";
const hintCls = "mt-0.5 text-[11px] text-neutral-400";

export function ProviderDialog({ target, onClose }: Props) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const providers = useProviders((s) => s.providers);
	const save = useProviders((s) => s.save);

	const isEdit = target.mode === "edit";
	const editing = isEdit ? target.provider : null;

	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [name, setName] = useState(editing?.name ?? "");
	const [slug, setSlug] = useState(editing?.slug ?? "");
	const [slugTouched, setSlugTouched] = useState(isEdit);
	const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
	const [api, setApi] = useState<ProviderApi>(editing?.api ?? "openai_completions");
	const [envVar, setEnvVar] = useState(editing?.envVar ?? "");
	const [apiKey, setApiKey] = useState("");
	const [modelRows, setModelRows] = useState<ModelRow[]>(() => {
		const rows = modelEntriesToRows(editing?.models ?? []);
		return rows.length > 0
			? rows
			: [{ id: "", name: null, contextWindow: "", maxTokens: "" }];
	});
	const [defaultModel, setDefaultModel] = useState(editing?.defaultModel ?? "");
	const [defaultContextWindow, setDefaultContextWindow] = useState(
		editing?.defaultContextWindow != null ? String(editing.defaultContextWindow) : "",
	);
	const [defaultMaxTokens, setDefaultMaxTokens] = useState(
		editing?.defaultMaxTokens != null ? String(editing.defaultMaxTokens) : "",
	);
	const [notes, setNotes] = useState(editing?.notes ?? "");
	const [advancedOpen, setAdvancedOpen] = useState(isEdit);
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	// Import mode state.
	const [pasteText, setPasteText] = useState("");
	const [importing, setImporting] = useState(false);

	// Model discovery state.
	const [fetchingModels, setFetchingModels] = useState(false);
	const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[] | null>(null);

	const isDirty = useMemo(() => {
		if (target.mode === "import") {
			return pasteText.trim().length > 0;
		}
		if (isEdit && editing) {
			const currentEntries = rowsToModelEntries(modelRows);
			return (
				name !== (editing.name ?? "") ||
				slug !== (editing.slug ?? "") ||
				baseUrl !== (editing.baseUrl ?? "") ||
				api !== (editing.api ?? "openai_completions") ||
				envVar !== (editing.envVar ?? "") ||
				apiKey.length > 0 ||
				JSON.stringify(currentEntries) !== JSON.stringify(editing.models ?? []) ||
				defaultModel !== (editing.defaultModel ?? "") ||
				defaultContextWindow !==
					(editing.defaultContextWindow != null
						? String(editing.defaultContextWindow)
						: "") ||
				defaultMaxTokens !==
					(editing.defaultMaxTokens != null
						? String(editing.defaultMaxTokens)
						: "") ||
				notes !== (editing.notes ?? "")
			);
		}
		const currentEntries = rowsToModelEntries(modelRows);
		return (
			selectedPresetId !== null ||
			name.length > 0 ||
			slug.length > 0 ||
			baseUrl.length > 0 ||
			api !== "openai_completions" ||
			envVar.length > 0 ||
			apiKey.length > 0 ||
			currentEntries.length > 0 ||
			defaultModel.length > 0 ||
			defaultContextWindow.length > 0 ||
			defaultMaxTokens.length > 0 ||
			notes.length > 0
		);
	}, [
		target.mode,
		isEdit,
		editing,
		pasteText,
		name,
		slug,
		baseUrl,
		api,
		envVar,
		apiKey,
		modelRows,
		defaultModel,
		defaultContextWindow,
		defaultMaxTokens,
		notes,
		selectedPresetId,
	]);

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
		(dialogRef.current?.querySelector<HTMLElement>("input, textarea")
			?? dialogRef.current?.querySelector<HTMLElement>("button"))?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);

	const applyPreset = (presetId: string) => {
		const p = PROVIDER_PRESETS.find((x) => x.id === presetId);
		setSelectedPresetId(presetId);
		if (!p) return;
		setAdvancedOpen(presetId === "custom");
		setName(p.name);
		if (!slugTouched) setSlug(slugify(p.name));
		setBaseUrl(p.baseUrl);
		setApi(p.api);
		setEnvVar(p.envVar);
		const rows = modelEntriesToRows(p.models);
		setModelRows(
			rows.length > 0
				? rows
				: [{ id: "", name: null, contextWindow: "", maxTokens: "" }],
		);
		setDefaultModel(p.defaultModel ?? "");
		setDefaultContextWindow("");
		setDefaultMaxTokens("");
	};

	const handleNameChange = (value: string) => {
		setName(value);
		if (!slugTouched && !isEdit) setSlug(slugify(value));
	};

	const enteredModelIds = useMemo(
		() => [
			...new Set(
				modelRows
					.map((r) => r.id.trim())
					.filter(Boolean),
			),
		],
		[modelRows],
	);

	const handleModelRowChange = (
		index: number,
		field: keyof ModelRow,
		value: string,
	) => {
		setModelRows((prev) => {
			const next = [...prev];
			next[index] = { ...next[index], [field]: value };
			return next;
		});
	};

	const handleAddModelRow = () => {
		setModelRows((prev) => [
			...prev,
			{ id: "", name: null, contextWindow: "", maxTokens: "" },
		]);
	};

	const handleRemoveModelRow = (index: number) => {
		setModelRows((prev) => prev.filter((_, i) => i !== index));
	};

	const handleFetchModels = async () => {
		const trimmedUrl = baseUrl.trim();
		if (!trimmedUrl) {
			toast.error("请先填写 Base URL");
			return;
		}
		setFetchingModels(true);
		try {
			const models = await providerFetchModels(
				trimmedUrl,
				api,
				apiKey.trim() || null,
				target.mode === "edit" ? target.provider.id : null,
			);
			setDiscoveredModels(models);
		} catch (err) {
			toast.error(`获取模型失败：${errMsg(err)}`);
		} finally {
			setFetchingModels(false);
		}
	};

	const handleModelPickerAppend = (selectedIds: string[]) => {
		const existingIds = new Set(modelRows.map((r) => r.id.trim()).filter(Boolean));
		const toAdd = selectedIds.filter((id) => !existingIds.has(id));
		const newRows = toAdd.map((id) => ({
			id,
			name: null,
			contextWindow: "",
			maxTokens: "",
		}));
		setModelRows((prev) => [...prev, ...newRows]);
		setDiscoveredModels(null);
		if (formError) setFormError(null);
	};

	const handleModelPickerReplace = (selectedIds: string[]) => {
		const newRows = selectedIds.map((id) => ({
			id,
			name: null,
			contextWindow: "",
			maxTokens: "",
		}));
		setModelRows(newRows);
		setDiscoveredModels(null);
		if (formError) setFormError(null);
	};

	const uniqueSlug = (base: string): string => {
		let slug = base;
		for (let i = 2; providers.some((p) => p.slug === slug); i++) {
			slug = `${base}-${i}`;
		}
		return slug;
	};

	const handleSave = async () => {
		setFormError(null);
		const parsedContextWindow = defaultContextWindow.trim()
			? parseInt(defaultContextWindow.trim(), 10)
			: null;
		const validContextWindow =
			parsedContextWindow !== null &&
			!Number.isNaN(parsedContextWindow) &&
			parsedContextWindow > 0
				? parsedContextWindow
				: null;

		const parsedMaxTokens = defaultMaxTokens.trim()
			? parseInt(defaultMaxTokens.trim(), 10)
			: null;
		const validMaxTokens =
			parsedMaxTokens !== null &&
			!Number.isNaN(parsedMaxTokens) &&
			parsedMaxTokens > 0
				? parsedMaxTokens
				: null;

		const models = rowsToModelEntries(modelRows);
		const trimmedDefault = defaultModel.trim();
		const defaultModelVal = trimmedDefault.length > 0 ? trimmedDefault : null;

		const config: ProviderConfig = editing
			? {
					...editing,
					name: name.trim(),
					slug: slug.trim(),
					baseUrl: baseUrl.trim(),
					api,
					envVar: envVar.trim().toUpperCase(),
					models,
					defaultModel: defaultModelVal,
					defaultContextWindow: validContextWindow,
					defaultMaxTokens: validMaxTokens,
					notes: notes.trim() || null,
				}
			: {
					...blankConfig(),
					presetId: selectedPresetId,
					name: name.trim(),
					slug: uniqueSlug(slug.trim() || slugify(name)),
					baseUrl: baseUrl.trim(),
					api,
					envVar: envVar.trim().toUpperCase(),
					models,
					defaultModel: defaultModelVal,
					defaultContextWindow: validContextWindow,
					defaultMaxTokens: validMaxTokens,
					notes: notes.trim() || null,
				};
		const missing: string[] = [];
		if (!config.name) missing.push("名称");
		if (!config.slug) missing.push("标识符");
		if (!config.baseUrl) missing.push("Base URL");
		if (!config.envVar) missing.push("环境变量名");
		if (missing.length > 0) {
			setAdvancedOpen(true);
			setFormError(`请填写${missing.join("、")}`);
			return;
		}
		if (config.models.length === 0) {
			setAdvancedOpen(true);
			setFormError("请至少填写一个模型 ID，才能在 OMP 中选择");
			return;
		}
		if (validContextWindow && validContextWindow > 2_000_000) {
			setAdvancedOpen(true);
			setFormError("默认上下文窗口不能超过 2,000,000");
			return;
		}
		if (validMaxTokens && validMaxTokens > 2_000_000) {
			setAdvancedOpen(true);
			setFormError("默认输出上限不能超过 2,000,000");
			return;
		}
		setSaving(true);
		try {
			const { config: toSave, count } = await applyContextWindowsOnSave(
				editing,
				config,
			);
			await save(toSave, apiKey.trim() || null);
			toast.success(
				apiKey.trim() ? "已保存，密钥已加密写入密钥库" : "已保存",
			);
			if (count > 0) toast.success(`按规则/目录为 ${count} 个模型设置了窗口`);
			onClose();
		} catch (err) {
			setFormError(errMsg(err));
		} finally {
			setSaving(false);
		}
	};

	// ---- .env import ----

	const importPlan = useMemo(() => {
		const seen = new Set<string>();
		return parseEnvText(pasteText)
			.filter((entry) => {
				if (seen.has(entry.key)) return false;
				seen.add(entry.key);
				return true;
			})
			.map((entry) => {
				const matched = matchPresetByEnvVar(entry.key);
				const existing = providers.find((p) => p.envVar === entry.key);
				if (!matched) return { entry, kind: "unknown" as const };
				if (existing) return { entry, kind: "update" as const, existing };
				return { entry, kind: "create" as const, preset: matched };
			});
	}, [pasteText, providers]);

	const importable = importPlan.filter((item) => item.kind !== "unknown").length;

	const handleImport = async () => {
		setImporting(true);
		let count = 0;
		try {
			for (const item of importPlan) {
				if (item.kind === "unknown") continue;
				if (item.kind === "update") {
					await save(item.existing, item.entry.value);
				} else {
					const config = {
						...blankConfig(),
						presetId: item.preset.id,
						name: item.preset.name,
						slug: uniqueSlug(item.preset.id),
						baseUrl: item.preset.baseUrl,
						api: item.preset.api,
						envVar: item.preset.envVar,
						models: item.preset.models,
						defaultModel: item.preset.defaultModel ?? null,
					};
					const { config: toSave, count: windowCount } =
						await applyContextWindowsOnSave(null, config);
					await save(toSave, item.entry.value);
					if (windowCount > 0)
						toast.success(`按规则/目录为 ${windowCount} 个模型设置了窗口`);
				}
				count++;
			}
			toast.success(`已导入 ${count} 个供应商密钥（加密存储）`);
			onClose();
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
			setImporting(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-md"
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
					const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
						'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
					)).filter((control) => control.getClientRects().length > 0);
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
						{isEdit
							? "编辑供应商"
							: target.mode === "import"
								? ".env 导入"
								: "添加供应商"}
					</div>
					<button
						type="button"
						onClick={() => void handleDismiss()}
						aria-label="关闭"
						className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{target.mode === "import" ? (
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						<div>
							<label htmlFor="provider-import" className={labelCls}>粘贴 .env 内容</label>
							<div className={hintCls}>
								支持多行，格式 <code className="font-mono">ANTHROPIC_API_KEY=sk-…</code>；
								能识别的变量会自动匹配预设
							</div>
							<textarea
								id="provider-import"
								value={pasteText}
								onChange={(e) => setPasteText(e.target.value)}
								rows={6}
								spellCheck={false}
								autoComplete="off"
								className={`${inputCls} font-mono`}
								placeholder={"ANTHROPIC_API_KEY=sk-ant-…\nOPENAI_API_KEY=sk-…"}
							/>
						</div>

						{importPlan.length > 0 && (
							<div className="space-y-1.5">
								<div className="text-xs font-medium text-neutral-300">
									预览（{importable} 个可导入）
								</div>
								{importPlan.map((item) => (
									<div
										key={item.entry.key}
										className="flex items-center justify-between rounded-lg bg-neutral-950 px-3 py-2 text-xs"
									>
										<span className="font-mono text-neutral-300">
											{item.entry.key}
										</span>
										<span className="flex items-center gap-2 text-[11px]">
											<span className="font-mono text-neutral-500">
												{maskKey(item.entry.value)}
											</span>
											{item.kind === "unknown" && (
												<span className="text-neutral-500">未识别，跳过</span>
											)}
											{item.kind === "create" && (
												<span className="text-emerald-400">
													新建 {item.preset.name}
												</span>
											)}
											{item.kind === "update" && (
												<span className="text-amber-400">
													更新 {item.existing.name} 的密钥
												</span>
											)}
										</span>
									</div>
								))}
							</div>
						)}
						<div className={hintCls}>
							密钥在保存时立即加密（AES-256-GCM，主密钥存于 macOS
							钥匙串），粘贴内容不会落盘为明文
						</div>
					</div>
				) : (
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						{!isEdit && (
							<div>
								<label className={labelCls}>从预设开始</label>
								<div className="mt-2 flex flex-wrap gap-1.5">
									{PROVIDER_PRESETS.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() => applyPreset(p.id)}
											className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all active:scale-95 ${
												selectedPresetId === p.id
													? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] font-medium"
													: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
											}`}
										>
											<span
												className="h-2 w-2 rounded-full"
												style={{ backgroundColor: p.color }}
											/>
											{p.name}
										</button>
									))}
								</div>
							</div>
						)}

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label htmlFor="provider-name" className={labelCls}>名称</label>
								<input
									id="provider-name"
									type="text"
									value={name}
									onChange={(e) => handleNameChange(e.target.value)}
									className={inputCls}
									placeholder="例如: 公司网关"
								/>
							</div>
							<div>
								<label htmlFor="provider-url" className={labelCls}>Base URL</label>
								<input
									id="provider-url"
									type="text"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									className={`${inputCls} font-mono`}
									placeholder="https://api.example.com/v1"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<div>
								<label htmlFor="provider-env" className={labelCls}>环境变量名</label>
								<input
									id="provider-env"
									type="text"
									value={envVar}
									onChange={(e) => setEnvVar(e.target.value.toUpperCase())}
									className={`${inputCls} font-mono`}
									placeholder="OPENAI_API_KEY"
								/>
							</div>
							<div>
								<label htmlFor="provider-key" className={labelCls}>API 密钥</label>
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
										placeholder={
											editing?.hasKey ? "留空保持不变" : "sk-…（保存后加密）"
										}
									/>
									<button
										type="button"
										onClick={() => setShowKey((value) => !value)}
										title={showKey ? "隐藏密钥" : "显示密钥"}
										aria-label={showKey ? "隐藏密钥" : "显示密钥"}
										className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200 active:scale-95 transition-all"
									>
										{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
									</button>
								</div>
								{editing?.hasKey && (
									<div className={`${hintCls} text-emerald-400/90`}>
										✓ 已保存{editing.keyHint ? `（末尾 …${editing.keyHint}）` : ""}，留空则继续使用
									</div>
								)}
							</div>
						</div>

						<div className="border-t border-[var(--border-divider)] pt-3">
							<button
								type="button"
								onClick={() => setAdvancedOpen((value) => !value)}
								aria-expanded={advancedOpen}
								className="flex w-full items-center justify-between text-left text-xs text-neutral-300 hover:text-neutral-100 transition-colors"
							>
								<span>进阶设置</span>
								<ChevronDown size={14} className={advancedOpen ? "rotate-180" : ""} />
							</button>
							{advancedOpen && (
								<div className="mt-3 space-y-3">
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										<div>
											<label htmlFor="provider-slug" className={labelCls}>标识符</label>
											<input
												id="provider-slug"
												type="text"
												value={slug}
												onChange={(e) => {
													setSlug(e.target.value);
													setSlugTouched(true);
												}}
												className={`${inputCls} font-mono`}
												placeholder="my-gateway"
											/>
										</div>
										<div>
											<label htmlFor="provider-api" className={labelCls}>协议</label>
											<NativeSelect
												id="provider-api"
												value={api}
												onChange={(e) => setApi(e.target.value as ProviderApi)}
												containerClassName="mt-1.5"
											>
												{Object.entries(API_LABELS).map(([value, label]) => (
													<option key={value} value={value}>{label}</option>
												))}
											</NativeSelect>
										</div>
									</div>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
										<div>
											<label htmlFor="provider-default-ctx" className={labelCls}>默认上下文窗口 (tokens)</label>
											<input
												id="provider-default-ctx"
												type="number"
												min={1}
												max={2000000}
												value={defaultContextWindow}
												onChange={(e) => setDefaultContextWindow(e.target.value)}
												className={`${inputCls} font-mono`}
												placeholder="例如: 128000（留空为 32768）"
											/>
										</div>
										<div>
											<label htmlFor="provider-default-max-tokens" className={labelCls}>默认输出上限 (tokens)</label>
											<input
												id="provider-default-max-tokens"
												type="number"
												min={1}
												max={2000000}
												value={defaultMaxTokens}
												onChange={(e) => setDefaultMaxTokens(e.target.value)}
												className={`${inputCls} font-mono`}
												placeholder="例如: 4096（留空为 4096）"
											/>
										</div>
									</div>

									<div>
										<div className="flex items-center justify-between">
											<label className={labelCls}>模型列表</label>
											<div className="flex items-center gap-2">
												<button
													type="button"
													onClick={() => void handleFetchModels()}
													disabled={fetchingModels}
													className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-40 transition-all"
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
													onClick={handleAddModelRow}
													className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] active:scale-95 transition-all"
												>
													<Plus className="h-3 w-3" />
													<span>添加模型</span>
												</button>
											</div>
										</div>
										<p className={hintCls}>配置模型 ID；各模型上下文窗口和输出上限若留空，将继承上方供应商默认值。</p>

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
													key={index}
													className="grid grid-cols-[1fr_88px_88px_28px] items-center gap-2"
												>
													<input
														type="text"
														value={row.id}
														onChange={(e) =>
															handleModelRowChange(index, "id", e.target.value)
														}
														className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all"
														placeholder="例如: gpt-4o"
													/>
													<input
														type="number"
														min={1}
														max={2000000}
														value={row.contextWindow}
														onChange={(e) =>
															handleModelRowChange(index, "contextWindow", e.target.value)
														}
														className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all"
														placeholder="默认"
													/>
													<input
														type="number"
														min={1}
														max={2000000}
														value={row.maxTokens}
														onChange={(e) =>
															handleModelRowChange(index, "maxTokens", e.target.value)
														}
														className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all"
														placeholder="默认"
													/>
													<button
														type="button"
														onClick={() => handleRemoveModelRow(index)}
														aria-label={`删除第 ${index + 1} 个模型`}
														title="删除模型"
														className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-rose-950/40 hover:text-rose-300 active:scale-95 transition-all"
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
										<p className={hintCls}>配置密钥后以 ompws-{slug.trim() || slugify(name) || "标识符"}/模型 ID 选择。</p>
									</div>

									<div>
										<label htmlFor="provider-default" className={labelCls}>默认模型（可选）</label>
										<input
											id="provider-default"
											type="text"
											list="provider-default-models-list"
											value={defaultModel}
											onChange={(e) => setDefaultModel(e.target.value)}
											className={`${inputCls} font-mono`}
											placeholder="未指定时自动选择第一个可用模型"
										/>
										<datalist id="provider-default-models-list">
											{enteredModelIds.map((id) => (
												<option key={id} value={id} />
											))}
										</datalist>
										<p className={hintCls}>供应商标记模型，用于未明确指定模型时的默认选择。可在下拉列表中选择或手动输入。</p>
									</div>
									<div>
										<label htmlFor="provider-notes" className={labelCls}>备注（可选）</label>
										<input id="provider-notes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="例如: 团队共享额度" />
									</div>
								</div>
							)}
						</div>
					</div>
				)}

				{formError && (
					<div className="mx-4 mb-2 rounded-xl border border-rose-800/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
						{formError}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					<button
						type="button"
						onClick={() => void handleDismiss()}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						取消
					</button>
					{target.mode === "import" ? (
						<button
							type="button"
							disabled={importable === 0 || importing}
							onClick={() => void handleImport()}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
						>
							{importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>确认导入（{importable}）</span>
						</button>
					) : (
						<button
							type="button"
							disabled={saving}
							onClick={() => void handleSave()}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
						>
							{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>保存{apiKey.trim() ? "并加密密钥" : ""}</span>
						</button>
					)}
				</div>
			</div>

			{discoveredModels && (
				<ModelPickerModal
					models={discoveredModels}
					existingModelIds={new Set(modelRows.map((r) => r.id.trim()).filter(Boolean))}
					onClose={() => setDiscoveredModels(null)}
					onAppend={handleModelPickerAppend}
					onReplace={handleModelPickerReplace}
				/>
			)}
		</div>
	);
}
