import { ChevronDown, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderApi, ProviderConfig } from "../../lib/contracts";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { maskKey, parseEnvText, slugify } from "./envparse";
import { API_LABELS, matchPresetByEnvVar, PROVIDER_PRESETS } from "./presets";
import { useProviders } from "./store";

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
	"mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none";
const labelCls = "block text-xs font-medium text-neutral-200";
const hintCls = "mt-0.5 text-[11px] text-neutral-500";

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
	const [modelsText, setModelsText] = useState((editing?.models ?? []).join("\n"));
	const [defaultModel, setDefaultModel] = useState(editing?.defaultModel ?? "");
	const [notes, setNotes] = useState(editing?.notes ?? "");
	const [advancedOpen, setAdvancedOpen] = useState(isEdit);
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	// Import mode state.
	const [pasteText, setPasteText] = useState("");
	const [importing, setImporting] = useState(false);

	useEscapeKey(onClose);
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
		setModelsText(p.models.join("\n"));
		setDefaultModel(p.defaultModel ?? "");
	};

	const handleNameChange = (value: string) => {
		setName(value);
		if (!slugTouched && !isEdit) setSlug(slugify(value));
	};

	const models = useMemo(
		() =>
			[...new Set(modelsText
				.split(/[\n,]/)
				.map((m) => m.trim())
				.filter(Boolean))],
		[modelsText],
	);

	const uniqueSlug = (base: string): string => {
		let slug = base;
		for (let i = 2; providers.some((p) => p.slug === slug); i++) {
			slug = `${base}-${i}`;
		}
		return slug;
	};

	const handleSave = async () => {
		setFormError(null);
		const config: ProviderConfig = editing
			? {
					...editing,
					name: name.trim(),
					slug: slug.trim(),
					baseUrl: baseUrl.trim(),
					api,
					envVar: envVar.trim().toUpperCase(),
					models,
					defaultModel: models.includes(defaultModel) ? defaultModel : null,
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
					defaultModel: models.includes(defaultModel) ? defaultModel : null,
					notes: notes.trim() || null,
				};
		if (!config.name || !config.slug || !config.baseUrl || !config.envVar) {
			setAdvancedOpen(true);
			setFormError("请填写名称、Base URL 和环境变量名");
			return;
		}
		if (config.models.length === 0) {
			setAdvancedOpen(true);
			setFormError("请至少填写一个模型 ID，才能在 OMP 中选择");
			return;
		}
		setSaving(true);
		try {
			await save(config, apiKey.trim() || null);
			toast.success(
				apiKey.trim() ? "已保存，密钥已加密写入密钥库" : "已保存",
			);
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
					await save(config, item.entry.value);
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
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
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
				className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
			>
				<div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
					<div id="provider-dialog-title" className="text-xs font-semibold text-neutral-100">
						{isEdit
							? "编辑供应商"
							: target.mode === "import"
								? ".env 导入"
								: "添加供应商"}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="关闭"
						className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
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
											className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
												selectedPresetId === p.id
													? "border-amber-500 bg-neutral-800 text-neutral-100"
													: "border-neutral-700 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
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
										className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 text-neutral-500 hover:text-neutral-200"
									>
										{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
									</button>
								</div>
								{editing?.hasKey && editing.keyHint && (
									<div className={hintCls}>已配置 (…{editing.keyHint})</div>
								)}
							</div>
						</div>

						<div className="border-t border-neutral-800 pt-3">
							<button
								type="button"
								onClick={() => setAdvancedOpen((value) => !value)}
								aria-expanded={advancedOpen}
								className="flex w-full items-center justify-between text-left text-xs text-neutral-300 hover:text-neutral-100"
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
											<select
												id="provider-api"
												value={api}
												onChange={(e) => setApi(e.target.value as ProviderApi)}
												className={inputCls}
											>
												{Object.entries(API_LABELS).map(([value, label]) => (
													<option key={value} value={value}>{label}</option>
												))}
											</select>
										</div>
									</div>
									<div>
										<label htmlFor="provider-models" className={labelCls}>模型 ID</label>
										<textarea
											id="provider-models"
											value={modelsText}
											onChange={(e) => setModelsText(e.target.value)}
											rows={3}
											spellCheck={false}
											className={inputCls}
											placeholder="每行一个模型"
										/>
										<p className={hintCls}>配置密钥后以 ompws-{slug.trim() || slugify(name) || "标识符"}/模型 ID 选择。默认上下文 32K，输出上限 4K。</p>
									</div>

									{models.length > 0 && (
										<div>
											<label htmlFor="provider-default" className={labelCls}>供应商列表标记模型</label>
											<select id="provider-default" value={models.includes(defaultModel) ? defaultModel : ""} onChange={(e) => setDefaultModel(e.target.value)} className={inputCls}>
												<option value="">（不指定）</option>
												{models.map((m) => <option key={m} value={m}>{m}</option>)}
											</select>
										</div>
									)}
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
					<div className="mx-4 mb-2 rounded-lg border border-rose-800/50 bg-rose-950/20 px-3 py-2 text-xs text-rose-300">
						{formError}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						取消
					</button>
					{target.mode === "import" ? (
						<button
							type="button"
							disabled={importable === 0 || importing}
							onClick={() => void handleImport()}
							className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
						>
							{importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>确认导入（{importable}）</span>
						</button>
					) : (
						<button
							type="button"
							disabled={saving}
							onClick={() => void handleSave()}
							className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
						>
							{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>保存{apiKey.trim() ? "并加密密钥" : ""}</span>
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
