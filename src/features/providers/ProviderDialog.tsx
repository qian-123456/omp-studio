import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Activity, ChevronDown, CircleCheck, CircleX, Eye, EyeOff, FolderOpen, Loader2, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { Modal } from "../../components/Modal";
import { NativeSelect } from "../../components/NativeSelect";
import type { DiscoveredModel, ProviderRow } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompModelsSetContextWindows, providerFetchModels, providerReadEnvFile } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { loadProviderWindows, setProviderWindow as saveProviderWindow } from "../settings/contextWindow/core";
import { useModelCatalog } from "../../stores/modelCatalog";
import { applyContextWindowsOnSave } from "./contextWindowOnSave";
import { planEnvImport } from "./envImport";
import { maskKey } from "./envparse";
import { initialEnvName, initialKeyInputMode, type KeyInputMode as Mode, type KeyInputProblem, keyInputProblem, keyToSend, toastKeySaved } from "./keyInput";
import { MODELS_YML_PATH } from "./keyState";
import { insecureHttpWarning } from "./httpWarning";
import { isProbeFailed } from "./modelClass";
import type { ModelCategory } from "./modelClass";
import { ModelPickerModal } from "./ModelPickerModal";
import { type ModelRow, modelEntriesToRows, rowsToModelEntries } from "./modelEntry";
import { KNOWN_APIS, PROVIDER_PRESETS, presetById, SERVICE_PURPOSES, SERVICE_API_LABELS, serviceApiSupportsKind, INVALID_PROVIDER_APIS } from "./presets";
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
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const cellCls =
	"w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 hover:border-[var(--border-divider)] focus:border-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:bg-[var(--well-bg)] focus:outline-none transition-all";
const batchCellCls =
	"w-full rounded-md hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";
const labelCls = "block text-xs font-medium text-neutral-200";
const hintCls = "mt-1 text-[11px] text-neutral-400";
const MODEL_TABLE_GRID = "grid grid-cols-[minmax(0,1fr)_116px_110px_92px] items-center gap-2";
const PROBE_CONCURRENCY = 4;
const digitsOnly = (value: string): string => value.replace(/[^0-9]/g, "");

export function ProviderDialog({ target, onClose, pickerCategory = "chat" }: Props) {
	const { t } = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const rows = useProviders((s) => s.rows);
	const upsert = useProviders((s) => s.upsert);
	const setKey = useProviders((s) => s.setKey);
	const saveBuiltin = useProviders((s) => s.saveBuiltin);
	const remove = useProviders((s) => s.remove);
	const runTest = useProviders((s) => s.runTest);
	const runModelTest = useProviders((s) => s.runModelTest);
	const test = useProviders((s) => (target.mode === "edit" ? s.tests[target.row.id] : undefined));
	const modelTests = useProviders((s) => s.modelTests) ?? {};

	const editing = target.mode === "edit" ? target.row : null;
	const isImport = target.mode === "import";
	/** Built-in or override rows: name/protocol are fixed, address is optional, models are additions. */
	const isBuiltin = editing !== null && editing.origin !== "custom";
	const isOverride = editing?.origin === "override";
	const defaultBaseUrl = editing?.defaultBaseUrl ?? null;
	const initialModels = isBuiltin ? (editing?.extraModels ?? []) : (editing?.models ?? []);
	const serviceMode = pickerCategory === "other";
	const [purpose, setPurpose] = useState(initialModels.map((m) => typeof m === "string" ? undefined : m.kind).find(Boolean) ?? "image");
	const purposeSpec = SERVICE_PURPOSES.find((p) => p.kind === purpose) ?? SERVICE_PURPOSES[0];
	const availableApis = KNOWN_APIS;

	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [presetOpen, setPresetOpen] = useState(false);
	const presetBtnRef = useRef<HTMLButtonElement>(null);
	const [id, setId] = useState(editing?.id ?? "");
	const [baseUrl, setBaseUrl] = useState(
		isBuiltin && editing?.baseUrl === defaultBaseUrl ? "" : (editing?.baseUrl ?? ""),
	);
	const [authNone, setAuthNone] = useState(editing?.authNone ?? false);
	const [removing, setRemoving] = useState(false);
	const initialApi = editing?.api ?? (serviceMode ? "" : "openai-completions");
	const isKnownApi = (serviceMode && initialApi === "") || availableApis.some((a) => a.value === initialApi);
	const [apiChoice, setApiChoice] = useState(isKnownApi ? initialApi : OTHER_API);
	const [apiOther, setApiOther] = useState(isKnownApi ? "" : initialApi);
	const initialMode = initialKeyInputMode(editing);
	const initialEnv = initialEnvName(editing, editing ? presetById(editing.id)?.envVar : undefined);
	const [keyMode, setKeyMode] = useState<Mode>(initialMode);
	const [envName, setEnvName] = useState(initialEnv);
	const [keyAttempted, setKeyAttempted] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [howOpen, setHowOpen] = useState(false);
	const keyProblem = authNone || isImport
		? null
		: keyInputProblem({ mode: keyMode, envName, plainKey: apiKey, requirePlainKey: editing !== null && initialMode === "env" });
	const [modelRows, setModelRows] = useState<ModelRow[]>(() => modelEntriesToRows(initialModels));
	const [newModelInput, setNewModelInput] = useState("");
	const rowsContainerRef = useRef<HTMLDivElement>(null);
	const [providerWindow, setProviderWindow] = useState(() => {
		const saved = editing ? loadProviderWindows()[editing.id] : undefined;
		return saved == null ? "" : String(saved);
	});
	const [providerWindowChanged, setProviderWindowChanged] = useState(false);
	const [batchMaxTokens, setBatchMaxTokens] = useState("");
	const [probingAll, setProbingAll] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	// .env import state.
	const [pasteText, setPasteText] = useState("");
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
				providerWindowChanged ||
				newModelInput.trim().length > 0 ||
				id !== editing.id ||
				baseUrl !== (isBuiltin && editing.baseUrl === defaultBaseUrl ? "" : (editing.baseUrl ?? "")) ||
				api !== (editing.api ?? "") ||
				authNone !== editing.authNone ||
				apiKey.length > 0 ||
				(!authNone && (keyMode !== initialMode || (keyMode === "env" && envName !== initialEnv))) ||
				JSON.stringify(entries) !== JSON.stringify(initialModels)
			);
		}
		return (
			providerWindowChanged ||
			selectedPresetId !== null ||
			newModelInput.trim().length > 0 ||
			id.length > 0 ||
			baseUrl.length > 0 ||
			apiKey.length > 0 ||
			(keyMode === "env" && envName.length > 0) ||
			api !== (serviceMode ? "" : "openai-completions") ||
			entries.length > 0
		);
	}, [isImport, pasteText, editing, isBuiltin, defaultBaseUrl, initialModels, id, baseUrl, api, authNone, apiKey, keyMode, envName, initialMode, initialEnv, modelRows, selectedPresetId, providerWindowChanged, newModelInput, serviceMode]);

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
		setPresetOpen(false);
		if (!p) return;
		setEnvName(p.envVar);
		setAuthNone(Boolean(p.noKey));
		setKeyMode("plain");
		setId(p.id === "custom" ? "" : uniqueId(p.id));
		setBaseUrl(p.baseUrl);
		const nextApi = serviceMode ? "" : p.api;
		const known = serviceMode || availableApis.some((a) => a.value === nextApi);
		setApiChoice(known ? nextApi : OTHER_API);
		setApiOther(known ? "" : nextApi);
		const preset = serviceMode ? [] : modelEntriesToRows(p.models);
		setModelRows(
			preset.map((row) => ({
				...row,
				contextWindow: providerWindow || row.contextWindow,
				maxTokens: batchMaxTokens || row.maxTokens,
			})),
		);
	};

	const resetPreset = () => {
		setSelectedPresetId(null);
		setPresetOpen(false);
		setId("");
		setBaseUrl("");
		setAuthNone(false);
		setKeyMode("plain");
		setEnvName("");
		setApiKey("");
		const nextApi = serviceMode ? "" : "openai-completions";
		setApiChoice(nextApi);
		setApiOther("");
		setModelRows([]);
		setNewModelInput("");
	};

	const buildAppendedRows = useCallback(
		(prev: ModelRow[], raw: string): ModelRow[] => {
			const rawIds = raw
				.split(/[\s,，\n]+/)
				.map((part) => part.trim())
				.filter(Boolean);
			const existing = new Set(prev.map((r) => r.id.trim()).filter(Boolean));
			const additions: ModelRow[] = [];
			for (const mid of rawIds) {
				if (!mid || existing.has(mid)) continue;
				existing.add(mid);
				additions.push({
					...blankModelRow(),
					id: mid,
					contextWindow: providerWindow,
					maxTokens: batchMaxTokens,
					...(serviceMode ? { kind: purpose, api: purposeSpec.apis[0] } : {}),
				});
			}
			return additions.length > 0 ? [...prev, ...additions] : prev;
		},
		[providerWindow, batchMaxTokens, serviceMode, purpose, purposeSpec],
	);

	const appendFromInput = (raw: string) => {
		if (!raw.trim()) return;
		setModelRows((prev) => buildAppendedRows(prev, raw));
		setNewModelInput("");
		if (formError) setFormError(null);
		requestAnimationFrame(() => {
			if (rowsContainerRef.current) {
				rowsContainerRef.current.scrollTop = rowsContainerRef.current.scrollHeight;
			}
		});
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
				authNone || keyMode === "env" ? null : apiKey.trim() || null,
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
		const fresh = selectedIds.map((mid) => ({
			...blankModelRow(),
			id: mid,
			contextWindow: providerWindow,
			maxTokens: batchMaxTokens,
			...(serviceMode ? { kind: purpose, api: purposeSpec.apis[0] } : {}),
		}));
		setModelRows((prev) => {
			if (!append) return fresh;
			const existing = new Set(prev.map((r) => r.id.trim()).filter(Boolean));
			return [...prev, ...fresh.filter((r) => !existing.has(r.id))];
		});
		setDiscoveredModels(null);
		if (formError) setFormError(null);
	};

	const handleProbeAll = async () => {
		if (!editing || !editing.testable || probingAll || !runModelTest) return;
		const ids = modelRows.map((r) => r.id.trim()).filter(Boolean);
		if (ids.length === 0) return;
		setProbingAll(true);
		let cursor = 0;
		const worker = async () => {
			while (cursor < ids.length) {
				const mid = ids[cursor++];
				await runModelTest(editing.id, mid);
			}
		};
		try {
			await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, ids.length) }, worker));
		} finally {
			setProbingAll(false);
		}
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
		const effectiveModelRows = newModelInput.trim() ? buildAppendedRows(modelRows, newModelInput) : modelRows;
		if (newModelInput.trim()) {
			setModelRows(effectiveModelRows);
			setNewModelInput("");
		}
		if (!serviceMode && providerWindow && (!Number.isSafeInteger(Number(providerWindow)) || Number(providerWindow) < 1 || Number(providerWindow) > 2000000)) {
			setFormError(`${t("providers.colContextWindow")}: ${t("providers.batchContextPlaceholder")}`);
			return;
		}
		if (INVALID_PROVIDER_APIS[api] === true || effectiveModelRows.some((row) => row.id.trim() && ["web-search", "local-inference", "factory-droid-agent"].includes(row.api || api))) {
			setFormError(t("providers.unsupportedServiceProtocol"));
			return;
		}
		const enteredModels = rowsToModelEntries(effectiveModelRows);
		if (!api && (enteredModels.length === 0 || enteredModels.some((model) => typeof model === "string" || !model.api?.trim()))) {
			setFormError(t("providers.explicitModelApisRequired"));
			return;
		}
		const incompatible = effectiveModelRows.find((row) => {
			if (!row.id.trim() || !row.kind) return false;
			const effectiveApi = row.api || api;
			if (serviceApiSupportsKind(row.kind, effectiveApi) !== false) return false;
			return !initialModels.some((m) => typeof m !== "string" && m.id === row.id && m.kind === row.kind && (m.api || editing?.api) === effectiveApi);
		});
		if (incompatible) {
			setFormError(t("providers.incompatibleServiceApi", { id: incompatible.id }));
			return;
		}
		if (keyProblem) {
			setKeyAttempted(true);
			return;
		}
		const key = authNone ? "" : (keyToSend({ mode: keyMode, envName, plainKey: apiKey }) ?? "");
		const url = baseUrl.trim();
		if (editing && isBuiltin) {
			const extra = rowsToModelEntries(effectiveModelRows);
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
				const savedRow = await saveBuiltin(
					{ id: editing.id, baseUrl: url || null, authNone, extraModels: config.models },
					key || null,
				);
				if (!serviceMode && providerWindowChanged && providerWindow) {
					const overrides = new Map(config.models.map((model) => [
						typeof model === "string" ? model : model.id,
						typeof model === "string" ? undefined : model.contextWindow,
					]));
					const ids = new Set([...editing.models, ...config.models].map((model) => typeof model === "string" ? model : model.id));
					await ompModelsSetContextWindows([...ids].map((modelId) => ({
						providerId: editing.id, modelId,
						contextWindow: overrides.get(modelId) ?? Number(providerWindow),
					})));
				}
				if (!serviceMode && providerWindowChanged) {
					saveProviderWindow(editing.id, providerWindow ? Number(providerWindow) : null);
					void useModelCatalog.getState().refresh();
				}
				toastKeySaved(savedRow, keyMode, t("providers.savedToast"));
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
		if (missing.length > 0) {
			setFormError(t("providers.missingFieldsError", { fields: missing.join(t("providers.fieldListSeparator")) }));
			return;
		}
		if (rows.some((r) => r.id === newId && r.id !== editing?.id)) {
			setFormError(t("providers.duplicateIdError", { id: newId }));
			return;
		}
		const models = rowsToModelEntries(effectiveModelRows);
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
			const savedRow = await upsert(
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
			);
			if (!serviceMode && providerWindowChanged && providerWindow) {
				await ompModelsSetContextWindows(config.models.map((model) => ({
					providerId: newId,
					modelId: typeof model === "string" ? model : model.id,
					contextWindow: (typeof model === "string" ? null : model.contextWindow) ?? Number(providerWindow),
				})));
			}
			if (!serviceMode && providerWindowChanged) {
				saveProviderWindow(newId, providerWindow ? Number(providerWindow) : null);
				void useModelCatalog.getState().refresh();
			}
			toastKeySaved(savedRow, keyMode, t("providers.savedToast"));
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
					await setKey(item.row.id, item.entry.value);
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
					);
				}
				count++;
			}
			toast.success(
				t("providers.importSuccessToast", { count }),
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

	const selectedPreset = selectedPresetId ? presetById(selectedPresetId) : undefined;
	const problemKey: Record<KeyInputProblem, string> = {
		envEmpty: "providers.envNameEmpty",
		envInvalid: "providers.envNameInvalid",
		plainLooksLikeName: "providers.plainLooksLikeName",
		plainRequired: "providers.errorEmptyKey",
	};
	const showKeyProblem =
		!authNone &&
		keyProblem !== null &&
		(keyAttempted || (keyProblem !== "envEmpty" && keyProblem !== "plainRequired"));
	const shownEnvName = envName.trim();
	const envStatus = editing?.key.kind === "envVar" && editing.key.envVar === shownEnvName ? editing.key.envSet : undefined;
	const testableModels = modelRows.map((r) => r.id.trim()).filter(Boolean);
	const activeAuthSeg = authNone ? "none" : keyMode;

	return (
		<>
		<Modal
			onClose={() => void handleDismiss()}
			size="xl"
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
				<div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-divider)] px-4 py-2.5">
					<div className="min-w-0">
						<div className="text-xs font-semibold tracking-[-0.018em] text-neutral-100">
							{editing ? t("providers.titleEdit") : isImport ? t("providers.titleImport") : t("providers.titleAdd")}
						</div>
						{!isImport && (
							<div className="mt-0.5 text-[11px] text-neutral-400">
								{editing ? t("providers.dialogEditSubtitle") : t("providers.dialogAddSubtitle")}
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{!editing && !isImport && (
							<>
								<button
									ref={presetBtnRef}
									type="button"
									aria-expanded={presetOpen}
									aria-haspopup="dialog"
									onClick={() => setPresetOpen((v) => !v)}
									className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
								>
									<span
										className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/15"
										style={{ backgroundColor: selectedPreset?.color ?? "var(--accent)" }}
									/>
									<span>{selectedPreset ? selectedPreset.name : t("providers.startFromPreset")}</span>
									<ChevronDown className={`h-3 w-3 text-neutral-400 transition-transform ${presetOpen ? "rotate-180" : ""}`} />
								</button>
								{selectedPreset && (
									<button
										type="button"
										onClick={resetPreset}
										className="whitespace-nowrap rounded-lg hairline bg-transparent px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
									>
										{t("providers.presetResetBtn")}
									</button>
								)}
								{presetOpen && (
									<FloatingLayer
										anchor={presetBtnRef.current}
										placement="bottom-end"
										offset={6}
										layer="popover"
										onDismiss={() => setPresetOpen(false)}
										ignoreRefs={[presetBtnRef]}
										role="dialog"
										aria-label={t("providers.startFromPreset")}
										className="w-[348px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-3 shadow-xl"
									>
										<div className="mb-2 text-[11px] text-neutral-400">{t("providers.presetPopoverHint")}</div>
										<div className="grid grid-cols-2 gap-1.5">
											{PROVIDER_PRESETS.map((p) => (
												<button
													key={p.id}
													type="button"
													onClick={() => applyPreset(p.id)}
													className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all active:scale-95 ${
														selectedPresetId === p.id
															? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]"
															: "hairline bg-[var(--well-bg)] text-neutral-200 hover:bg-[var(--bg-hover)]"
													}`}
												>
													<span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/15" style={{ backgroundColor: p.color }} />
													<span className="min-w-0 flex-1 whitespace-nowrap">{p.name}</span>
													{p.noKey && (
														<span className="shrink-0 whitespace-nowrap rounded bg-neutral-800/80 px-1 py-0.5 text-[10px] text-neutral-400">
															{t("providers.keyModeNoneShort")}
														</span>
													)}
												</button>
											))}
										</div>
									</FloatingLayer>
								)}
							</>
						)}
						<button
							type="button"
							onClick={() => void handleDismiss()}
							aria-label={t("common.close")}
							className="rounded-md p-1 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
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
						<p className="text-[11px] leading-relaxed text-neutral-500">{t("providers.keyPlainNote", { path: MODELS_YML_PATH })}</p>
					</div>
				) : (
					<div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
						{/* 1. Core connection & credentials */}
						<section className="space-y-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/45 p-2.5">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_268px]">
								<div className="min-w-0">
									<div className="flex items-center gap-0.5">
										<label htmlFor="provider-name" className={labelCls}>
											{t("providers.nameLabel")}
										</label>
										{!isBuiltin && <span aria-hidden="true" className="text-xs font-medium text-rose-400">*</span>}
									</div>
									<input
										id="provider-name"
										type="text"
										value={id}
										onChange={(e) => setId(e.target.value)}
										readOnly={isBuiltin}
										spellCheck={false}
										className={`mt-1.5 ${inputCls} font-mono ${isBuiltin ? "cursor-default opacity-70" : ""}`}
										placeholder={t("providers.namePlaceholder")}
									/>
									<div className={hintCls}>
										{isBuiltin ? t("providers.builtinNameHint") : t("providers.customNameHint")}
									</div>
								</div>
								<div className="min-w-0">
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
										<NativeSelect
											id="provider-api"
											value={apiChoice}
											onChange={(e) => setApiChoice(e.target.value)}
											containerClassName="mt-1.5"
										>
											{serviceMode && <option value="">{t("providers.perModelApi")}</option>}
											{availableApis.map((a) => (
												<option key={a.value} value={a.value}>
													{a.label}
												</option>
											))}
											<option value={OTHER_API}>{t("providers.otherApiOption")}</option>
										</NativeSelect>
									)}
								</div>
							</div>

							{!isBuiltin && apiChoice === OTHER_API && (
								<div>
									<input
										type="text"
										value={apiOther}
										onChange={(e) => setApiOther(e.target.value)}
										aria-label={t("providers.otherApiAria")}
										spellCheck={false}
										className={`${inputCls} font-mono`}
										placeholder={t("providers.otherApiPlaceholder")}
									/>
								</div>
							)}

							{serviceMode && (
								<div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
									<div>
										<label htmlFor="provider-purpose" className={labelCls}>{t("providers.servicePurpose")}</label>
										<NativeSelect
											id="provider-purpose"
											value={purpose}
											containerClassName="mt-1.5"
											onChange={(event) => {
												const next = SERVICE_PURPOSES.find((p) => p.kind === event.target.value)!;
												setPurpose(next.kind);
												setModelRows((prev) => prev.map((row) => (row.id.trim() ? row : { ...row, kind: next.kind, api: next.apis[0] })));
											}}
										>
											{SERVICE_PURPOSES.map((p) => (
												<option key={p.kind} value={p.kind}>
													{t(p.key)}
												</option>
											))}
										</NativeSelect>
									</div>
									<p className="text-[11px] leading-relaxed text-neutral-400 sm:pt-5">
										{t("providers.servicePurposeHint")}
									</p>
								</div>
							)}

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="min-w-0">
									<div className="flex min-h-[22px] items-center gap-0.5">
										<label htmlFor="provider-url" className={labelCls}>
											{t("providers.urlLabel")}
										</label>
										{!isBuiltin && <span aria-hidden="true" className="text-xs font-medium text-rose-400">*</span>}
									</div>
									<input
										id="provider-url"
										type="text"
										value={baseUrl}
										onChange={(e) => setBaseUrl(e.target.value)}
										spellCheck={false}
										className={`mt-1.5 ${inputCls} font-mono`}
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

								<div className="min-w-0">
									<div className="flex min-h-[22px] flex-wrap items-center justify-between gap-1.5">
										<label
											htmlFor={activeAuthSeg === "env" ? "provider-env-name" : activeAuthSeg === "plain" ? "provider-key" : undefined}
											className={labelCls}
										>
											{t("providers.apiKeyLabel")}
										</label>
										<div
											role="radiogroup"
											aria-label={t("providers.keyInputLegend")}
											className="inline-flex shrink-0 items-center rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-0.5"
										>
											{(
												[
													{ value: "plain", label: t("providers.keyModeDirectShort") },
													{ value: "env", label: t("providers.keyModeEnvShort") },
													{ value: "none", label: t("providers.keyModeNoneShort") },
												] as const
											).map((opt) => {
												const checked = activeAuthSeg === opt.value;
												return (
													<button
														key={opt.value}
														type="button"
														role="radio"
														aria-checked={checked}
														onClick={() => {
															if (opt.value === "none") {
																setAuthNone(true);
															} else {
																setAuthNone(false);
																setKeyMode(opt.value);
															}
														}}
														className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] transition-colors ${
															checked
																? "bg-[var(--bg-panel)] font-medium text-neutral-100 shadow-2xs"
																: "text-neutral-400 hover:text-neutral-200"
														}`}
													>
														{opt.label}
													</button>
												);
											})}
										</div>
									</div>

									{activeAuthSeg === "plain" && (
										<div className="mt-1.5">
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
													aria-invalid={showKeyProblem}
													className={`${inputCls} pr-9 font-mono`}
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
													className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 transition-all hover:text-neutral-200 active:scale-95"
												>
													{showKey ? <EyeOff size={14} /> : <Eye size={14} />}
												</button>
											</div>
											<p className={hintCls}>{t("providers.keyPlainNote", { path: MODELS_YML_PATH })}</p>
										</div>
									)}

									{activeAuthSeg === "env" && (
										<div className="mt-1.5 space-y-1.5">
											<input
												id="provider-env-name"
												type="text"
												value={envName}
												onChange={(e) => setEnvName(e.target.value.trim())}
												onKeyDown={(e) => {
													if (e.key === "Enter" && !isComposing(e)) void handleSave();
												}}
												spellCheck={false}
												autoCapitalize="characters"
												autoComplete="off"
												aria-label={t("providers.envNameLabel")}
												aria-invalid={showKeyProblem}
												placeholder={t("providers.envNamePlaceholder")}
												className={`${inputCls} font-mono`}
											/>
											<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
												{envStatus !== undefined ? (
													<span className={envStatus === true ? "text-emerald-400" : "text-amber-400"}>
														{envStatus === true
															? t("providers.envStatusSet", { name: shownEnvName })
															: t("providers.envStatusUnset", { name: shownEnvName })}
													</span>
												) : (
													<span>{t("providers.envHint")}</span>
												)}
												<button
													type="button"
													aria-expanded={howOpen}
													onClick={() => setHowOpen((v) => !v)}
													className="whitespace-nowrap rounded-full hairline bg-[var(--well-bg)] px-2 py-0.5 text-neutral-300 hover:bg-[var(--bg-hover)]"
												>
													{howOpen ? t("providers.envHowHide") : t("providers.envHowShow")}
												</button>
											</div>
											{howOpen && (
												<ul className="list-disc space-y-1 rounded-lg hairline bg-[var(--well-bg)] py-2 pl-6 pr-3 text-[11px] leading-relaxed text-neutral-400">
													<li>{t("providers.envExplainWhere")}</li>
													<li>{t("providers.envExplainFix")}</li>
												</ul>
											)}
										</div>
									)}

									{activeAuthSeg === "none" && (
										<div className="mt-1.5 flex h-[30px] items-center rounded-lg border border-dashed border-[var(--border-divider)] bg-[var(--well-bg)] px-3 text-[11px] text-neutral-400">
											{t("providers.authNoneCheck")}
										</div>
									)}

									{showKeyProblem && keyProblem && (
										<div role="alert" className="mt-1 select-text break-words text-[11px] text-rose-300">
											{t(problemKey[keyProblem])}
										</div>
									)}
								</div>
							</div>
						</section>

						{/* 2. Models table: header batch adjust + fixed-height scrollable rows + pinned add bar */}
						<section className="space-y-2 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/45 p-2.5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className={labelCls}>
										{isBuiltin ? t("providers.modelsHeaderExtra") : t("providers.modelsHeaderAll")}
									</span>
									<span className="inline-flex items-center rounded-full bg-[var(--bg-active-fill)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-neutral-300">
										{modelRows.length}
									</span>
								</div>
								<div className="flex flex-wrap items-center gap-1.5">
									<button
										type="button"
										onClick={() => void handleProbeAll()}
										disabled={!editing || !editing.testable || probingAll || testableModels.length === 0}
										title={
											!editing
												? t("providers.probeNeedSaved")
												: !editing.testable
													? t("providers.cannotTestReason")
													: t("providers.probeAllRowTitle")
										}
										className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-2.5 py-1 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-40"
									>
										{probingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
										<span>{t("providers.probeAllBtn")}</span>
									</button>
									<button
										type="button"
										onClick={() => void handleFetchModels()}
										disabled={fetchingModels}
										className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--accent)] transition-all hover:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] active:scale-95 disabled:opacity-40"
									>
										{fetchingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
										<span>{t("providers.fetchModelsBtn")}</span>
									</button>
								</div>
							</div>

							{isBuiltin && (
								<p className="text-[11px] text-neutral-400">
									{t("providers.builtinModelsHint", { count: Math.max(0, (editing?.models.length ?? 0) - (editing?.extraModels.length ?? 0)) })}
								</p>
							)}

							<div className="overflow-hidden rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)]">
								<div className={`${MODEL_TABLE_GRID} border-b border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3 py-1.5 text-[11px] font-medium text-neutral-400`}>
									<span>{t("providers.colModelId")}</span>
									<span>{t("providers.colContextWindow")}</span>
									<span>{t("providers.colMaxTokens")}</span>
									<span className="text-right">{t("providers.colActions")}</span>
								</div>

								{!serviceMode && (
									<div className={`${MODEL_TABLE_GRID} border-b border-[var(--border-divider)] bg-[var(--well-bg)]/55 px-3 py-1.5`}>
										<span className="text-[11px] text-neutral-400">{t("providers.batchAdjustLabel")}</span>
										<input
											type="text"
											inputMode="numeric"
											value={providerWindow}
											aria-label={t("providers.colContextWindow")}
											onChange={(e) => {
												const value = digitsOnly(e.target.value);
												setProviderWindowChanged(true);
												setProviderWindow(value);
												setModelRows((prev) => prev.map((row) => ({ ...row, contextWindow: value })));
											}}
											className={batchCellCls}
											placeholder={t("providers.batchContextPlaceholder")}
										/>
										<input
											type="text"
											inputMode="numeric"
											value={batchMaxTokens}
											aria-label={t("providers.batchMaxTokensAria")}
											onChange={(e) => {
												const value = digitsOnly(e.target.value);
												setBatchMaxTokens(value);
												setModelRows((prev) => prev.map((row) => ({ ...row, maxTokens: value })));
											}}
											className={batchCellCls}
											placeholder={t("providers.batchMaxTokensPlaceholder")}
										/>
										<div className="text-right">
											{providerWindow || batchMaxTokens ? (
												<button
													type="button"
													onClick={() => {
														setProviderWindowChanged(true);
														setProviderWindow("");
														setBatchMaxTokens("");
														setModelRows((prev) => prev.map((row) => ({ ...row, contextWindow: "", maxTokens: "" })));
													}}
													className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
												>
													{t("providers.batchClearBtn")}
												</button>
											) : (
												<span className="whitespace-nowrap text-[11px] text-neutral-500">{t("providers.batchSyncTip")}</span>
											)}
										</div>
									</div>
								)}

								<div
									ref={rowsContainerRef}
									className="h-[144px] divide-y divide-[var(--border-divider)] overflow-y-auto"
								>
									{modelRows.length === 0 ? (
										<div className="flex h-full items-center justify-center px-4 text-center text-xs text-neutral-500">
											{isBuiltin ? t("providers.builtinNoExtraModels") : t("providers.customNoModels")}
										</div>
									) : (
										modelRows.map((row, index) => {
											const mid = row.id.trim();
											const modelTest = editing && mid ? modelTests[`${editing.id}::${mid}`] : undefined;
											const testingModel = modelTest?.state === "testing";
											const testedDone = modelTest?.state === "done";
											const failed = isProbeFailed(modelTest);
											const testTitle = !editing
												? t("providers.probeNeedSaved")
												: !editing.testable
													? t("providers.cannotTestReason")
													: testedDone
														? `${modelTest.result.detail}${t("providers.latencyOpen")}${modelTest.result.latencyMs}ms${t("providers.latencyClose")}`
														: t("providers.testModelTitle", { id: mid || String(index + 1) });
											return (
												<div
													// biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable identity while being typed
													key={index}
													className="px-3 py-1.5"
												>
													<div className={MODEL_TABLE_GRID}>
														<input
															type="text"
															value={row.id}
															onChange={(e) => handleModelRowChange(index, "id", e.target.value)}
															aria-label={t("providers.modelIdAria", { index: index + 1 })}
															className={cellCls}
															placeholder={t("providers.modelIdPlaceholder")}
														/>
														<input
															type="text"
															inputMode="numeric"
															value={row.contextWindow}
															onChange={(e) => handleModelRowChange(index, "contextWindow", digitsOnly(e.target.value))}
															aria-label={t("providers.contextWindowAria", { index: index + 1 })}
															className={cellCls}
															placeholder={t("providers.contextWindowPlaceholder")}
														/>
														<input
															type="text"
															inputMode="numeric"
															value={row.maxTokens}
															onChange={(e) => handleModelRowChange(index, "maxTokens", digitsOnly(e.target.value))}
															aria-label={t("providers.maxTokensAria", { index: index + 1 })}
															className={cellCls}
															placeholder={t("providers.maxTokensPlaceholder")}
														/>
														<div className="flex items-center justify-end gap-1">
															<button
																type="button"
																onClick={() => editing && mid && runModelTest && void runModelTest(editing.id, mid)}
																disabled={!editing || !editing.testable || !mid || testingModel}
																title={testTitle}
																aria-label={t("providers.testModelAria", { id: mid || String(index + 1) })}
																className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md hairline px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
																	testedDone
																		? failed
																			? "border-rose-700/40 bg-rose-950/30 text-rose-300"
																			: "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
																		: "bg-[var(--well-bg)] text-neutral-300 hover:bg-[var(--bg-hover)]"
																}`}
															>
																{testingModel ? (
																	<Loader2 className="h-3 w-3 animate-spin" />
																) : testedDone ? (
																	failed ? <CircleX className="h-3 w-3" /> : <CircleCheck className="h-3 w-3" />
																) : null}
																<span>
																	{testingModel
																		? t("providers.modelTestRunning")
																		: testedDone
																			? failed
																				? t("providers.modelTestFail")
																				: t("providers.modelTestOk")
																			: t("providers.testBtn")}
																</span>
															</button>
															<button
																type="button"
																onClick={() => setModelRows((prev) => prev.filter((_, i) => i !== index))}
																aria-label={t("providers.deleteModelAria", { index: index + 1 })}
																title={t("providers.deleteModelTitle")}
																className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-all hover:bg-rose-950/40 hover:text-rose-300 active:scale-95"
															>
																<X className="h-3.5 w-3.5" />
															</button>
														</div>
													</div>
													{(serviceMode || row.kind || row.api) && (
														<div className="mt-1.5 grid grid-cols-2 gap-2 pb-1">
															<label className="text-[11px] text-neutral-400">
																{t("providers.servicePurpose")}
																<NativeSelect
																	value={row.kind ?? ""}
																	containerClassName="mt-1"
																	onChange={(event) => {
																		const next = SERVICE_PURPOSES.find((p) => p.kind === event.target.value);
																		setModelRows((prev) =>
																			prev.map((r, i) =>
																				i === index
																					? { ...r, kind: event.target.value || undefined, api: next?.apis[0] }
																					: r,
																			),
																		);
																	}}
																>
																	<option value="">{t("providers.inheritPurpose")}</option>
																	<option value="chat">{t("providers.purposeChat")}</option>
																	{row.kind && row.kind !== "chat" && !SERVICE_PURPOSES.some((p) => p.kind === row.kind) && (
																		<option value={row.kind}>{row.kind}</option>
																	)}
																	{SERVICE_PURPOSES.map((p) => (
																		<option key={p.kind} value={p.kind}>
																			{t(p.key)}
																		</option>
																	))}
																</NativeSelect>
															</label>
															<label className="text-[11px] text-neutral-400">
																{t("providers.apiLabel")}
																<NativeSelect
																	value={row.api ?? ""}
																	containerClassName="mt-1"
																	onChange={(event) => handleModelRowChange(index, "api", event.target.value)}
																>
																	<option value="">{t("providers.inheritApi")}</option>
																	{[
																		...new Set([
																			...(SERVICE_PURPOSES.find((p) => p.kind === row.kind)?.apis ?? KNOWN_APIS.map((a) => a.value)),
																			...(row.api ? [row.api] : []),
																		]),
																	].map((value) => (
																		<option key={value} value={value}>
																			{SERVICE_API_LABELS[value] ?? KNOWN_APIS.find((a) => a.value === value)?.label ?? value}
																		</option>
																	))}
																</NativeSelect>
															</label>
														</div>
													)}
												</div>
											);
										})
									)}
								</div>

								{/* Pinned bottom add-model bar */}
								<div className="flex items-center gap-2 border-t border-[var(--border-divider)] bg-[var(--bg-active-fill)]/55 px-3 py-2">
									<input
										type="text"
										value={newModelInput}
										onChange={(e) => setNewModelInput(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && !isComposing(e)) {
												e.preventDefault();
												appendFromInput(newModelInput);
											}
										}}
										onPaste={(e) => {
											const text = e.clipboardData.getData("text");
											if (/[\s,，\n]/.test(text)) {
												e.preventDefault();
												appendFromInput(`${newModelInput} ${text}`);
											}
										}}
										aria-label={t("providers.newModelInputAria")}
										spellCheck={false}
										className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none"
										placeholder={t("providers.newModelInputPlaceholder")}
									/>
									<button
										type="button"
										onClick={() => appendFromInput(newModelInput)}
										disabled={newModelInput.trim() === ""}
										className="shrink-0 whitespace-nowrap rounded-lg hairline bg-[var(--bg-panel)] px-3 py-1 text-xs font-medium text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-40"
									>
										{t("providers.addModelBtn")}
									</button>
								</div>
							</div>
						</section>
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

				<div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-2.5">
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
