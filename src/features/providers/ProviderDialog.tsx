import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Activity, Eye, EyeOff, FolderOpen, Loader2, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { NativeSelect } from "../../components/NativeSelect";
import type { DiscoveredModel, KeyMode, ProviderRow } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { providerFetchModels, providerReadEnvFile } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { applyContextWindowsOnSave } from "./contextWindowOnSave";
import { planEnvImport } from "./envImport";
import { maskKey } from "./envparse";
import { insecureHttpWarning } from "./httpWarning";
import { KeyModeRadio } from "./KeyModeRadio";
import { ModelPickerModal } from "./ModelPickerModal";
import type { ModelCategory } from "./modelClass";
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
	/** Which tab the "fetch models" picker opens on (the other-model panel opens on "other"). */
	pickerCategory?: ModelCategory;
}

const OTHER_API = "__other__";
const blankModelRow = (): ModelRow => ({ id: "", name: null, contextWindow: "", maxTokens: "" });

const inputCls =
	"mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const cellCls =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const labelCls = "block text-xs font-medium text-neutral-200";
const hintCls = "mt-0.5 text-[11px] text-neutral-400";

export function ProviderDialog({ target, onClose, pickerCategory = "chat" }: Props) {
	const { t } = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const rows = useProviders((s) => s.rows);
	const upsert = useProviders((s) => s.upsert);
	const setKey = useProviders((s) => s.setKey);
	const saveBuiltin = useProviders((s) => s.saveBuiltin);
	const remove = useProviders((s) => s.remove);
	const runTest = useProviders((s) => s.runTest);
	const test = useProviders((s) => (target.mode === "edit" ? s.tests[target.row.id] : undefined));

	const editing = target.mode === "edit" ? target.row : null;
	const isImport = target.mode === "import";
	/** Built-in or override rows: name/protocol are fixed, address is optional, models are additions. */
	const isBuiltin = editing !== null && editing.origin !== "custom";
	const isOverride = editing?.origin === "override";
	const defaultBaseUrl = editing?.defaultBaseUrl ?? null;
	const initialModels = isBuiltin ? (editing?.extraModels ?? []) : (editing?.models ?? []);

	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [id, setId] = useState(editing?.id ?? "");
	const [baseUrl, setBaseUrl] = useState(
		isBuiltin && editing?.baseUrl === defaultBaseUrl ? "" : (editing?.baseUrl ?? ""),
	);
	const [authNone, setAuthNone] = useState(editing?.authNone ?? false);
	const [removing, setRemoving] = useState(false);
	const initialApi = editing?.api ?? "openai-completions";
	const isKnownApi = KNOWN_APIS.some((a) => a.value === initialApi);
	const [apiChoice, setApiChoice] = useState(isKnownApi ? initialApi : OTHER_API);
	const [apiOther, setApiOther] = useState(isKnownApi ? "" : initialApi);
	const [apiKey, setApiKey] = useState("");
	const initialKeyMode: KeyMode =
		editing?.key.kind === "encrypted" || editing?.key.kind === "vaultMissing" ? "encrypted" : "plaintext";
	const [keyMode, setKeyMode] = useState<KeyMode>(initialKeyMode);
	const [modelRows, setModelRows] = useState<ModelRow[]>(() => {
		const initial = modelEntriesToRows(initialModels);
		return initial.length > 0 || isBuiltin ? initial : [blankModelRow()];
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

	const api = isBuiltin ? (editing?.api ?? "") : apiChoice === OTHER_API ? apiOther.trim() : apiChoice;

	const isDirty = useMemo(() => {
		if (isImport) return pasteText.trim().length > 0;
		const entries = rowsToModelEntries(modelRows);
		if (editing) {
			return (
				id !== editing.id ||
				baseUrl !== (isBuiltin && editing.baseUrl === defaultBaseUrl ? "" : (editing.baseUrl ?? "")) ||
				api !== (editing.api ?? "") ||
				authNone !== editing.authNone ||
				apiKey.length > 0 ||
				(!authNone && keyMode !== initialKeyMode &&
					(editing.key.kind === "plaintext" || editing.key.kind === "encrypted" || editing.key.kind === "vaultMissing")) ||
				JSON.stringify(entries) !== JSON.stringify(initialModels)
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
	}, [isImport, pasteText, editing, isBuiltin, defaultBaseUrl, initialModels, id, baseUrl, api, authNone, apiKey, keyMode, initialKeyMode, modelRows, selectedPresetId]);

	const isClosingRef = useRef(false);
	const handleDismiss = useCallback(async () => {
		if (isClosingRef.current) return;
		if (isDirty) {
			isClosingRef.current = true;
			try {
				const ok = await confirmDialog(t("providers.discardConfirmMessage"), {
					danger: true,
					okLabel: t("providers.discardConfirmOk"),
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

	useEffect(() => {
		(
			dialogRef.current?.querySelector<HTMLElement>("input, textarea") ??
			dialogRef.current?.querySelector<HTMLElement>("button")
		)?.focus();
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
		const trimmedUrl = baseUrl.trim() || (isBuiltin ? (defaultBaseUrl ?? "") : "");
		if (!trimmedUrl) {
			toast.error(t("providers.enterUrlToast"));
			return;
		}
		if (!api) {
			toast.error(t("providers.enterApiToast"));
			return;
		}
		setFetchingModels(true);
		try {
			const models = await providerFetchModels(
				trimmedUrl,
				api,
				authNone ? null : apiKey.trim() || null,
				editing?.id ?? null,
			);
			setDiscoveredModels(models);
		} catch (err) {
			toast.error(t("providers.fetchModelsFailedToast", { error: errMsg(err) }));
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

	const handleRemove = async () => {
		if (!editing) return;
		const title = editing.displayName ?? editing.id;
		const ok = await confirmDialog(
			isOverride
				? t("providers.resetOverrideConfirmMessage")
				: t("providers.deleteConfirmMessage", { title }),
			isOverride
				? { title: t("providers.resetOverrideConfirmTitle"), danger: true, okLabel: t("providers.resetOverrideConfirmOk") }
				: { title: t("providers.deleteConfirmTitle"), danger: true, okLabel: t("providers.deleteConfirmOk") },
		);
		if (!ok) return;
		setRemoving(true);
		try {
			await remove(editing.id);
			toast.success(isOverride ? t("providers.resetSuccessToast") : t("providers.deleteSuccessToast"));
			onClose();
		} catch (err) {
			setFormError(errMsg(err));
			setRemoving(false);
		}
	};

	const handleSave = async () => {
		setFormError(null);
		const key = authNone ? "" : apiKey.trim();
		const url = baseUrl.trim();
		if (editing && isBuiltin) {
			const extra = rowsToModelEntries(modelRows);
			if (extra.length > 0 && !url && !defaultBaseUrl) {
				setFormError(t("providers.addModelNeedUrlError"));
				return;
			}
			setSaving(true);
			try {
				const { config, count } = await applyContextWindowsOnSave(
					{ models: editing.extraModels },
					{ models: extra },
				);
				await saveBuiltin(
					{ id: editing.id, baseUrl: url || null, authNone, extraModels: config.models },
					key || null,
					keyMode,
				);
				toast.success(key && keyMode === "encrypted" ? t("providers.savedEncryptedToast") : t("providers.savedToast"));
				if (count > 0) toast.success(t("providers.windowRuleCountToast", { count }));
				onClose();
			} catch (err) {
				setFormError(errMsg(err));
			} finally {
				setSaving(false);
			}
			return;
		}
		const newId = id.trim();
		const missing: string[] = [];
		if (!newId) missing.push(t("providers.fieldName"));
		if (!url) missing.push(t("providers.fieldUrl"));
		if (!api) missing.push(t("providers.fieldApi"));
		if (missing.length > 0) {
			setFormError(t("providers.missingFieldsError", { fields: missing.join(t("providers.fieldListSeparator")) }));
			return;
		}
		if (rows.some((r) => r.id === newId && r.id !== editing?.id)) {
			setFormError(t("providers.duplicateIdError", { id: newId }));
			return;
		}
		const models = rowsToModelEntries(modelRows);
		if (models.length === 0) {
			setFormError(t("providers.atLeastOneModelError"));
			return;
		}
		setSaving(true);
		try {
			const { config, count } = await applyContextWindowsOnSave(
				editing ? { models: editing.models } : null,
				{ models },
			);
			await upsert(
				{
					originalId: editing?.id ?? null,
					id: newId,
					displayName: editing?.displayName ?? null,
					baseUrl: url,
					api,
					models: config.models,
					authNone,
				},
				key || null,
				keyMode,
			);
			toast.success(key && keyMode === "encrypted" ? t("providers.savedEncryptedToast") : t("providers.savedToast"));
			if (count > 0) toast.success(t("providers.windowRuleCountToast", { count }));
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
							authNone: false,
						},
						item.entry.value,
						importMode,
					);
				}
				count++;
			}
			toast.success(
				t("providers.importSuccessToast", {
					count,
					mode: importMode === "encrypted" ? t("providers.importModeEncrypted") : t("providers.importModePlaintext"),
				}),
			);
			onClose();
		} catch (err) {
			toast.error(t("providers.importFailedToast", { error: errMsg(err) }));
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
				title: t("providers.selectEnvFileTitle"),
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
		<>
		<Modal
			onClose={() => void handleDismiss()}
			size="lg"
			ariaLabel={editing ? t("providers.titleEdit") : isImport ? t("providers.titleImport") : t("providers.titleAdd")}
		>
			<div
				ref={dialogRef}
				className="flex min-h-0 flex-1 flex-col"
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
			>
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] px-4 py-3">
					<div className="text-xs font-semibold tracking-[-0.018em] text-neutral-100">
						{editing ? t("providers.titleEdit") : isImport ? t("providers.titleImport") : t("providers.titleAdd")}
					</div>
					<button
						type="button"
						onClick={() => void handleDismiss()}
						aria-label={t("common.close")}
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
							<div className={labelCls}>{t("providers.readFileSection")}</div>
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
									aria-label={t("providers.envFilePathAria")}
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
									<span>{t("providers.readFileBtn")}</span>
								</button>
								<button
									type="button"
									onClick={() => void handlePickFile()}
									className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)]"
								>
									<FolderOpen className="h-3 w-3" />
									<span>{t("providers.selectFileBtn")}</span>
								</button>
							</div>
							<div className={hintCls}>
								{t("providers.hiddenFileHint")}
							</div>
							{fileError && (
								<div className="mt-1 select-text whitespace-pre-wrap break-words text-[11px] text-red-400">
									{fileError}
								</div>
							)}
						</div>
						<div>
							<label htmlFor="provider-import" className={labelCls}>
								{t("providers.pasteEnvLabel")}
							</label>
							<div className={hintCls}>
								{t("providers.pasteEnvHint")}
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
								<div className="text-xs font-medium text-neutral-300">{t("providers.previewCount", { count: importable })}</div>
								{importPlan.map((item) => (
									<div
										key={item.entry.key}
										className="flex items-center justify-between rounded-lg bg-neutral-950 px-3 py-2 text-xs"
									>
										<span className="font-mono text-neutral-300">{item.entry.key}</span>
										<span className="flex items-center gap-2 text-[11px]">
											<span className="font-mono text-neutral-500">{maskKey(item.entry.value)}</span>
											{item.kind === "unknown" && <span className="text-neutral-500">{t("providers.importUnknown")}</span>}
											{item.kind === "create" && (
												<span className="text-emerald-400">{t("providers.importCreate", { name: item.preset.name })}</span>
											)}
											{item.kind === "setKey" && (
												<span className="text-amber-400">{t("providers.importUpdate", { name: item.row.displayName ?? item.row.id })}</span>
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
								<div className={labelCls}>{t("providers.startFromPreset")}</div>
								<div className="mt-2 flex flex-wrap gap-1.5">
									{PROVIDER_PRESETS.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() => applyPreset(p.id)}
											className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all active:scale-95 ${
												selectedPresetId === p.id
													? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]"
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
									{t("providers.nameLabel")}
								</label>
								<input
									id="provider-name"
									type="text"
									value={id}
									onChange={(e) => setId(e.target.value)}
									readOnly={isBuiltin}
									spellCheck={false}
									className={`${inputCls} font-mono ${isBuiltin ? "cursor-default opacity-70" : ""}`}
									placeholder={t("providers.namePlaceholder")}
								/>
								<div className={hintCls}>
									{isBuiltin ? t("providers.builtinNameHint") : t("providers.customNameHint")}
								</div>
							</div>
							<div>
								<label htmlFor="provider-url" className={labelCls}>
									{t("providers.urlLabel")}
								</label>
								<input
									id="provider-url"
									type="text"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									className={`${inputCls} font-mono`}
									placeholder={isBuiltin ? (defaultBaseUrl ?? "https://api.example.com/v1") : "https://api.example.com/v1"}
								/>
								{isBuiltin && <div className={hintCls}>{t("providers.builtinUrlHint")}</div>}
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
								{t("providers.apiLabel")}
							</label>
							{isBuiltin ? (
								<div
									id="provider-api"
									className="mt-1.5 select-text break-all rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-300"
								>
									{editing?.api ?? t("providers.unknownApi")}
								</div>
							) : (
								<>
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
										<option value={OTHER_API}>{t("providers.otherApiOption")}</option>
									</NativeSelect>
									{apiChoice === OTHER_API && (
										<input
											type="text"
											value={apiOther}
											onChange={(e) => setApiOther(e.target.value)}
											aria-label={t("providers.otherApiAria")}
											spellCheck={false}
											className={`${inputCls} font-mono`}
											placeholder={t("providers.otherApiPlaceholder")}
										/>
									)}
								</>
							)}
						</div>

						<label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-200">
							<input
								type="checkbox"
								checked={authNone}
								onChange={(e) => setAuthNone(e.target.checked)}
								className="h-3.5 w-3.5 accent-[var(--accent)]"
							/>
							<span>{t("providers.authNoneCheck")}</span>
						</label>

						{!authNone && (
							<>
								<div>
									<label htmlFor="provider-key" className={labelCls}>
										{t("providers.apiKeyLabel")}
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
											placeholder={
												editing && editing.key.kind !== "missing" && editing.key.kind !== "none"
													? t("providers.keepUnchangedPlaceholder")
													: "sk-xxx"
											}
										/>
										<button
											type="button"
											onClick={() => setShowKey((value) => !value)}
											title={showKey ? t("providers.hideKey") : t("providers.showKey")}
											aria-label={showKey ? t("providers.hideKey") : t("providers.showKey")}
											className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-neutral-500 transition-all hover:text-neutral-200 active:scale-95"
										>
											{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
										</button>
									</div>
								</div>
								<KeyModeRadio name="provider-key-mode" value={keyMode} onChange={setKeyMode} />
							</>
						)}

						<div className="border-t border-[var(--border-divider)] pt-3">
							<div className="flex items-center justify-between">
								<span className={labelCls}>{isBuiltin ? t("providers.modelsHeaderExtra") : t("providers.modelsHeaderAll")}</span>
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
										<span>{t("providers.fetchModelsBtn")}</span>
									</button>
									<button
										type="button"
										onClick={() => setModelRows((prev) => [...prev, blankModelRow()])}
										className="inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs text-[var(--accent)] transition-all hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] active:scale-95"
									>
										<Plus className="h-3 w-3" />
										<span>{t("providers.addModelBtn")}</span>
									</button>
								</div>
							</div>
							<p className={hintCls}>
								{isBuiltin
									? t("providers.builtinModelsHint", { count: Math.max(0, (editing?.models.length ?? 0) - (editing?.extraModels.length ?? 0)) })
									: t("providers.customModelsHint")}
							</p>

							<div className="mt-2 space-y-1.5">
								{modelRows.length > 0 && (
									<div className="grid grid-cols-[1fr_88px_88px_28px] gap-2 px-1 text-[11px] font-medium text-neutral-400">
										<span>{t("providers.colModelId")}</span>
										<span>{t("providers.colContextWindow")}</span>
										<span>{t("providers.colMaxTokens")}</span>
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
											aria-label={t("providers.modelIdAria", { index: index + 1 })}
											className={cellCls}
											placeholder={t("providers.modelIdPlaceholder")}
										/>
										<input
											type="number"
											min={1}
											max={2000000}
											value={row.contextWindow}
											onChange={(e) => handleModelRowChange(index, "contextWindow", e.target.value)}
											aria-label={t("providers.contextWindowAria", { index: index + 1 })}
											className={cellCls}
											placeholder={t("providers.contextWindowPlaceholder")}
										/>
										<input
											type="number"
											min={1}
											max={2000000}
											value={row.maxTokens}
											onChange={(e) => handleModelRowChange(index, "maxTokens", e.target.value)}
											aria-label={t("providers.maxTokensAria", { index: index + 1 })}
											className={cellCls}
											placeholder={t("providers.maxTokensPlaceholder")}
										/>
										<button
											type="button"
											onClick={() => setModelRows((prev) => prev.filter((_, i) => i !== index))}
											aria-label={t("providers.deleteModelAria", { index: index + 1 })}
											title={t("providers.deleteModelTitle")}
											className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									</div>
								))}
								{modelRows.length === 0 && (
									<div className="rounded-lg hairline border-dashed border-neutral-700 p-3 text-center text-xs text-neutral-500">
										{isBuiltin ? t("providers.builtinNoExtraModels") : t("providers.customNoModels")}
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

				<div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					{editing && (
						<div className="mr-auto flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() => void runTest(editing.id)}
								disabled={!editing.testable || test?.state === "testing"}
								title={editing.testable ? t("providers.testSavedConfig") : t("providers.cannotTestReason")}
								className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-95 disabled:opacity-40"
							>
								{test?.state === "testing" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<Activity className="h-3 w-3" />
								)}
								<span>{t("providers.testConnBtn")}</span>
							</button>
							{test?.state === "done" && (
								<span
									className={`whitespace-nowrap text-[11px] ${test.result.ok ? "text-emerald-400" : "text-rose-400"}`}
								>
									{test.result.ok ? t("providers.connSuccess") : t("providers.connFailed")}
								</span>
							)}
							{editing.origin !== "builtin" && (
								<button
									type="button"
									onClick={() => void handleRemove()}
									disabled={removing}
									className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-xs text-neutral-300 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95 disabled:opacity-40"
								>
									{isOverride ? <RotateCcw className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
									<span>{isOverride ? t("providers.resetOverrideBtn") : t("common.delete")}</span>
								</button>
							)}
						</div>
					)}
					<button
						type="button"
						onClick={() => void handleDismiss()}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
					>
						{t("common.cancel")}
					</button>
					{isImport ? (
						<button
							type="button"
							disabled={importable === 0 || importing}
							onClick={() => void handleImport()}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
						>
							{importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>{t("providers.confirmImportBtn", { count: importable })}</span>
						</button>
					) : (
						<button
							type="button"
							disabled={saving}
							onClick={() => void handleSave()}
							className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
						>
							{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							<span>{t("common.save")}</span>
						</button>
					)}
				</div>
			</div>
		</Modal>

			{discoveredModels && (
				<ModelPickerModal
					models={discoveredModels}
					providerId={editing?.id ?? null}
					initialCategory={pickerCategory}
					existingModelIds={new Set(modelRows.map((r) => r.id.trim()).filter(Boolean))}
					onClose={() => setDiscoveredModels(null)}
					onAppend={(ids) => replaceModelRows(ids, true)}
					onReplace={(ids) => replaceModelRows(ids, false)}
				/>
			)}
		</>
	);
}
