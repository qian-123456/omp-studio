import clsx from "clsx";
import { AlertTriangle, Braces, Download, FolderGit2, KeyRound, RefreshCw, RotateCcw } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { ModelSelect, type ModelExtraOption } from "../../components/ModelSelect";
import { parseSelection } from "../../components/modelSelectLogic";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import type { OmpConfigEntry } from "../../lib/contracts";
import { confirmDialog } from "../../lib/dialogs";
import { ompConfigReset, ompConfigSet, ompProjectConfigRead } from "../../lib/ipc";
import { useModelOptions } from "../../stores/modelCatalog";
import { Switch } from "./Switch";
import { defaultState, defaultText, isStringList, lookupDotPath, parseProjectConfig, toStringList } from "./ompConfigEdit";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";
import { ompConfigValueDescription } from "./ompConfigDescZh";
import { OMP_CONFIG_META, ompConfigDescription, ompConfigOptionLabel, ompConfigOptions, ompConfigTitle } from "./ompConfigMeta";
import { useOmpConfigStore } from "./ompConfigStore";
import { useOmpInstall } from "../../stores/ompInstall";
import { tNow, useT } from "../../stores/language";
import {
	groupEntriesForPage,
	ompConditionHint,
	ompConditionMet,
	ompSectionTitle,
	ompTuiLocation,
	type OmpHostPage,
	type OmpSectionDef,
} from "./ompPlacement";
import { JsonEditor, RecordEditor, SecretInput, StringListEditor } from "./ompValueEditors";
import { EmptyState } from "../../components/EmptyState";
import { Notice } from "../../components/Notice";
import { Button, Chip, CommitInput, IconButton, MODEL_PICKER_BUTTON_CLASS, SaveIndicator, SectionHeader, SettingsCard, useSaveStatus } from "./ui";
import { SectionJumpBar } from "./SectionJumpBar";
import { useSettingsProjectCwd } from "./useAppSettings";

// ── Project layer ────────────────────────────────────────────────────

/** Project-layer value for a key from `<cwd>/.omp/config.yml`. */
interface ProjectOverride {
	path: string;
	value: unknown;
}

interface ProjectLayerContextValue {
	overrideFor(key: string): ProjectOverride | null;
	refresh(): void;
}

const ProjectLayerContext = createContext<ProjectLayerContextValue>({
	overrideFor: () => null,
	refresh: () => {},
});

/** Reads `<cwd>/.omp/config.yml` of the scope session; `refresh` re-reads after edits. */
function useProjectLayer(): ProjectLayerContextValue {
	const cwd = useSettingsProjectCwd();
	const [project, setProject] = useState<{ path: string; data: Record<string, unknown> } | null>(null);
	const [tick, setTick] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick re-reads after edits
	useEffect(() => {
		if (!cwd) {
			setProject(null);
			return;
		}
		let alive = true;
		ompProjectConfigRead(cwd)
			.then((f) => {
				if (alive) setProject(f.exists ? { path: f.path, data: parseProjectConfig(f.content) } : null);
			})
			.catch(() => {
				if (alive) setProject(null);
			});
		return () => {
			alive = false;
		};
	}, [cwd, tick]);
	const overrideFor = useCallback(
		(key: string): ProjectOverride | null => {
			if (!project) return null;
			const hit = lookupDotPath(project.data, key);
			return hit.found ? { path: project.path, value: hit.value } : null;
		},
		[project],
	);
	const refresh = useCallback(() => setTick((t) => t + 1), []);
	return useMemo(() => ({ overrideFor, refresh }), [overrideFor, refresh]);
}

// ── Row ──────────────────────────────────────────────────────────────

/** Sentinel select value for the "type a custom value" escape hatch. */
const CUSTOM_VALUE = "__custom__";

const SECRET_KEY = /(?:token|password|apikey|secret)$/i;

/** String settings whose value is a model selector or `@role`; edited with the model picker, not free text. */
const MODEL_TARGET_KEYS: Record<string, true> = { "prewalk.autoTarget": true };

function useRoleTargetExtras(): ModelExtraOption[] {
	const { t } = useT();
	return useMemo(
		() => [
			{ value: "@smol", label: t("settingsCore.ompList.modelTargetSmol"), hint: "@smol" },
			{ value: "@default", label: t("settingsCore.ompList.modelTargetDefault"), hint: "@default" },
			{ value: "@slow", label: t("settingsCore.ompList.modelTargetSlow"), hint: "@slow" },
		],
		[t],
	);
}

function ModelTargetPicker({ current, disabled, onPick }: { current: string; disabled: boolean; onPick: (value: string) => void }) {
	const { t } = useT();
	const models = useModelOptions();
	const extras = useRoleTargetExtras();
	const selector = parseSelection(current).selector;
	return (
		<ModelSelect
			disabled={disabled}
			closeOnSelect
			allowCustom
			align="start"
			widthClass="w-[360px]"
			label={selector || t("settingsCore.ompList.selectModelOrRole")}
			buttonClass={MODEL_PICKER_BUTTON_CLASS}
			models={models}
			currentValue={current}
			extras={extras}
			thinking
			onSelect={(v) => {
				if (v.trim() && v.trim() !== current) onPick(v.trim());
			}}
		/>
	);
}

function displayValue(value: unknown, unsetLabel = ""): string {
	if (value === null || value === undefined) return unsetLabel || tNow("settingsCore.ompList.unset");
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}


/** Tooltip for one option: the raw value (when the label hides it) plus the schema description. */
function optionTooltip(label: string, o: { value: string; description?: string }): string | undefined {
	const parts = [label !== o.value ? o.value : null, o.description].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

const PARENT_CHILD_KEYS: Record<string, { parent: string; reasonKey: string }> = {
	"compaction.asyncEnabled": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.dropUseless": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.experimentalContextManagement": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.handoffSaveToDisk": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.idleEnabled": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.methodOrder": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.midTurnEnabled": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.remoteStreamingV2Enabled": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.supersedeReads": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.thresholdPercent": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.thresholdTokens": { parent: "compaction.enabled", reasonKey: "compactionParentReason" },
	"compaction.idleThresholdTokens": { parent: "compaction.idleEnabled", reasonKey: "idleCompactionReason" },
	"compaction.idleTimeoutSeconds": { parent: "compaction.idleEnabled", reasonKey: "idleCompactionReason" },
	"bash.autoBackground.thresholdMs": { parent: "bash.autoBackground.enabled", reasonKey: "autoBackgroundReason" },
	"autolearn.autoContinue": { parent: "autolearn.enabled", reasonKey: "autoLearnReason" },
};

/** Row-level keyboard: ↑/↓ move between rows, Space toggles switches, Enter focuses the control. */
function handleRowKeys(e: KeyboardEvent<HTMLElement>) {
	const target = e.target as HTMLElement;
	const row = target.closest<HTMLElement>("[data-omp-row]");
	if (!row) return;
	const inField = target !== row && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
	if (inField) return;
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-omp-row]:not([data-omp-disabled])")];
		const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
		if (next) {
			e.preventDefault();
			next.focus();
			next.scrollIntoView({ block: "nearest" });
		}
		return;
	}
	if (target !== row) return;
	if (e.key === " " && row.dataset.ompType === "boolean") {
		e.preventDefault();
		row.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
	} else if (e.key === "Enter") {
		const field = row.querySelector<HTMLElement>("input, select, textarea, [role=radio][aria-checked=true], [role=switch]");
		if (field) {
			e.preventDefault();
			field.focus();
		}
	}
}

/** Write-only JSON input for redacted structured credentials (never pre-filled). */
function SecretJson({ entry, busy, onSave }: { entry: OmpConfigEntry; busy: boolean; onSave: (v: unknown) => Promise<boolean> }) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	if (!open) {
		return (
			<Button size="sm" icon={KeyRound} onClick={() => setOpen(true)}>
				{t("settingsCore.ompList.secretReplacePrompt")}
			</Button>
		);
	}
	return (
		<JsonEditor
			value={entry.valueType === "array" ? [] : {}}
			valueType={entry.valueType}
			busy={busy}
			onSave={onSave}
			onClose={() => setOpen(false)}
		/>
	);
}

/** Description clamped to two lines; the 「展开」 toggle appears only when text is actually cut. */
function ClampedDescription({ text }: { text: string }) {
	const { t } = useT();
	const ref = useRef<HTMLParagraphElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflow, setOverflow] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			if (!expanded) setOverflow(el.scrollHeight > el.clientHeight + 1);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [text, expanded]);
	return (
		<div className="mt-0.5">
			<p
				ref={ref}
				className={clsx("text-xs leading-[1.5] text-[var(--text-muted)]", !expanded && "line-clamp-2")}
			>
				{text}
			</p>
			{(overflow || expanded) && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-0.5 text-xs text-[var(--accent)] hover:underline"
				>
					{expanded ? t("settingsCore.ompList.collapse") : t("settingsCore.ompList.expand")}
				</button>
			)}
		</div>
	);
}

/**
 * One omp config entry: label (modified rows get an accent dot + reset),
 * clamped description and the control, edited in place with autosave.
 * Arrays/records get structured editors under the text with a raw-JSON escape hatch.
 */
export function OmpSettingRow({ entry, onChanged }: { entry: OmpConfigEntry; onChanged?: () => void }) {
	const save = useSaveStatus();
	const project = useContext(ProjectLayerContext);
	const load = useOmpConfigStore((s) => s.load);
	const { t, locale } = useT();
	const dep = PARENT_CHILD_KEYS[entry.key];
	const parentOn = useOmpConfigStore((s) =>
		dep ? s.entries.find((e) => e.key === dep.parent)?.value === true : true,
	);
	const hierarchyDisabled = !parentOn;
	const [busy, setBusy] = useState(false);
	const [jsonMode, setJsonMode] = useState(false);
	const [custom, setCustom] = useState(false);

	const changed = () => {
		if (onChanged) {
			onChanged();
			return;
		}
		// Re-list so edited values (and switches elsewhere) stay in sync with omp.
		void load(true);
		project.refresh();
	};

	const persist = async (raw: string) => {
		setBusy(true);
		try {
			const ok = await save.run(() => ompConfigSet(entry.key, raw));
			if (ok) changed();
			return ok;
		} finally {
			setBusy(false);
		}
	};
	const persistJson = (value: unknown) => persist(JSON.stringify(value));

	const depReason = dep ? t(`settingsCore.ompList.${dep.reasonKey}`) : undefined;
	const title = ompConfigTitle(entry.key, locale);
	const description = (
		(locale !== "en-US"
			? ompConfigValueDescription(
					entry.key,
					entry.value === null || entry.value === undefined ? OMP_CONFIG_DEFAULTS[entry.key] : entry.value,
				)
			: null) ?? ompConfigDescription(entry.key, entry.description, locale)
	).trim();
	const warning = OMP_CONFIG_META[entry.key]?.warning?.trim() ?? "";
	const override = project.overrideFor(entry.key);
	const state = defaultState(entry.key, entry.value, entry.redacted);
	const defText = defaultText(entry.key);
	const isUnset = entry.value === null || entry.value === undefined;
	const modified = state === "modified";
	// Unknown defaults: only offer reset when something is actually set.
	const canReset = modified || (state === "unknown" && !isUnset);

	const reset = async () => {
		const target = defText ? t("settingsCore.ompList.defaultTarget", { target: defText }) : t("settingsCore.ompList.ompDefaultTarget");
		if (!(await confirmDialog(t("settingsCore.ompList.restoreDefaultConfirm", { title, target }), { danger: true, okLabel: t("settingsCore.ompList.restoreDefault") }))) return;
		setBusy(true);
		try {
			const ok = await save.run(() => ompConfigReset(entry.key));
			if (ok) {
				setJsonMode(false);
				setCustom(false);
				changed();
			}
		} finally {
			setBusy(false);
		}
	};

	const isStructured = entry.valueType === "array" || entry.valueType === "record";
	// omp redacts stored credentials; unset ones arrive as plain empty strings, so
	// credential-looking keys stay write-only too.
	const secret = entry.redacted || SECRET_KEY.test(entry.key);
	const strict = (OMP_CONFIG_META[entry.key]?.values?.length ?? 0) > 0 || entry.valueType === "enum";
	const options = isStructured || secret ? null : ompConfigOptions(entry.key);
	const current = isUnset ? "" : typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
	const inOptions = options?.some((o) => o.value === current) ?? false;
	const labeled = options?.map((o) => ({ ...o, text: ompConfigOptionLabel(entry.key, o, locale) }));

	let control: ReactNode = null;
	if (secret && !isStructured) {
		control = <SecretInput isSet={entry.redacted || !isUnset} busy={busy} label={title} onSave={persist} />;
	} else if (entry.valueType === "boolean") {
		control = (
			<Switch checked={entry.value === true} disabled={busy} onChange={(v) => void persist(v ? "true" : "false")} />
		);
	} else if (labeled && strict && labeled.length <= 4 && labeled.every((o) => o.text.length <= 10)) {
		control = (
			<Segmented
				size="sm"
				aria-label={title}
				disabled={busy}
				value={current}
				options={labeled.map((o) => ({ value: o.value, label: o.text, title: optionTooltip(o.text, o) }))}
				onChange={(v) => void persist(v)}
			/>
		);
	} else if (labeled) {
		const showCustom = !strict && (custom || (!inOptions && !isUnset));
		control = (
			<div className="flex items-center gap-1.5">
				<NativeSelect
					aria-label={title}
					value={showCustom ? CUSTOM_VALUE : inOptions ? current : ""}
					disabled={busy}
					onChange={(e) => {
						if (e.target.value === CUSTOM_VALUE) {
							setCustom(true);
						} else if (e.target.value) {
							setCustom(false);
							void persist(e.target.value);
						}
					}}
					containerClassName="w-48"
					className="text-xs"
				>
					{!inOptions && !showCustom && <option value="">{isUnset ? t("settingsCore.ompList.unset") : current}</option>}
					{labeled.map((o) => (
						<option key={o.value} value={o.value} title={optionTooltip(o.text, o)}>
							{o.text}
						</option>
					))}
					{!strict && <option value={CUSTOM_VALUE}>{t("settingsCore.ompList.custom")}</option>}
				</NativeSelect>
				{showCustom && (
					<CommitInput
						className="w-28"
						type={entry.valueType === "number" ? "number" : "text"}
						mono
						value={current}
						aria-label={t("settingsCore.ompList.customLabel", { title })}
						validate={(v) => (entry.valueType === "number" && !Number.isFinite(Number(v)) ? t("settingsCore.ompList.numberRequired") : null)}
						onCommit={async (v) => {
							if (!(await persist(v))) throw new Error(save.error ?? t("settingsCore.ompList.saveFailed"));
						}}
					/>
				)}
			</div>
		);
	} else if (entry.valueType === "number") {
		control = (
			<CommitInput
				className="w-36"
				type="number"
				value={current}
				placeholder={defText && state !== "default" ? t("settingsCore.ompList.defaultLabel", { value: defText }) : undefined}
				aria-label={title}
				validate={(v) => (v === "" || Number.isFinite(Number(v)) ? null : t("settingsCore.ompList.numberRequired"))}
				onCommit={(v) => (v === "" ? ompConfigReset(entry.key).then(changed) : ompConfigSet(entry.key, v).then(changed))}
			/>
		);
	} else if (MODEL_TARGET_KEYS[entry.key] && !isStructured) {
		control = (
			<ModelTargetPicker
				disabled={busy}
				current={current}
				onPick={(v) => void persist(v)}
			/>
		);
	} else if (!isStructured) {
		control = (
			<CommitInput
				className="w-64"
				mono
				value={current}
				placeholder={defText && defText !== t("settingsCore.ompList.unset") ? t("settingsCore.ompList.defaultLabel", { value: defText }) : t("settingsCore.ompList.unset")}
				aria-label={title}
				onCommit={(v) => ompConfigSet(entry.key, v).then(changed)}
			/>
		);
	}

	const stringList = entry.valueType === "array" && isStringList(entry.value);
	const tuiLocation = ompTuiLocation(entry.key, locale);
	const labelTooltip = [
		modified ? t("settingsCore.ompList.defaultWithFallback", { value: defText ?? t("settingsCore.ompList.ompDefaultTarget") }) : null,
		tuiLocation,
		t("settingsCore.ompList.configKey", { key: entry.key }),
	]
		.filter(Boolean)
		.join("\n");

	return (
		<div
			data-omp-key={entry.key}
			data-omp-row=""
			data-omp-type={entry.valueType}
			data-omp-disabled={hierarchyDisabled ? "" : undefined}
			tabIndex={hierarchyDisabled ? undefined : -1}
			className={clsx(
				"px-4 py-3 outline-none transition-colors",
				hierarchyDisabled
					? "pointer-events-none border-l-2 border-[var(--border-divider)] pl-6 opacity-50"
					: "focus-visible:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
			)}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
						{modified && (
							<span
								aria-hidden
								className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
								title={labelTooltip}
							/>
						)}
						<span
							className={clsx(
								"text-[13px] font-medium",
								modified ? "text-[var(--accent)]" : "text-[var(--text)]",
							)}
							title={labelTooltip}
						>
							{title}
						</span>
						{warning && (
							<span className="text-[var(--status-warning)]" title={warning} role="img" aria-label={t("settingsCore.ompList.riskWarning")}>
								⚠
							</span>
						)}
						{secret && (entry.redacted || !isUnset) && <Chip tone="success">{t("settingsCore.ompList.isSet")}</Chip>}
						{secret && (
							<Chip icon={KeyRound} title={t("settingsCore.ompList.secretBadgeTitle")}>
								{t("settingsCore.ompList.secretBadge")}
							</Chip>
						)}
						{override && (
							<Chip
								tone="accent"
								icon={FolderGit2}
								title={t("settingsCore.ompList.projectOverriddenTitle", { path: override.path, value: displayValue(override.value, t("settingsCore.ompList.unset")) })}
							>
								{t("settingsCore.ompList.projectOverridden")}
							</Chip>
						)}
						<SaveIndicator status={save.status} error={save.error} />
					</div>
					{warning && <div className="mt-0.5 text-xs leading-[1.5] text-[var(--status-warning)]">{warning}</div>}
					{description && <ClampedDescription text={description} />}
					{hierarchyDisabled && dep && (
						<div className="mt-1 text-xs text-[var(--status-warning)]">{depReason}</div>
					)}
					{save.status === "error" && save.error && (
						<div className="mt-1 flex select-text items-start gap-1 text-xs text-[var(--status-error)]">
							<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
							<span className="break-all">{save.error}</span>
						</div>
					)}
				</div>
				{(control || canReset) && (
					<div className="flex shrink-0 items-center gap-1.5 pt-0.5">
						{control}
						{canReset && (
							<IconButton
								icon={RotateCcw}
								label={t("settingsCore.ompList.restoreDefault")}
								size="sm"
								disabled={busy}
								onClick={() => void reset()}
							/>
						)}
					</div>
				)}
			</div>

			{isStructured && (
				<div className="mt-2">
					{entry.redacted ? (
						<SecretJson entry={entry} busy={busy} onSave={persistJson} />
					) : jsonMode ? (
						<JsonEditor
							value={entry.value}
							valueType={entry.valueType}
							busy={busy}
							onSave={persistJson}
							onClose={() => setJsonMode(false)}
						/>
					) : (
						<>
							{entry.valueType === "array" && stringList ? (
								<StringListEditor value={toStringList(entry.value)} busy={busy} onSave={persistJson} />
							) : entry.valueType === "record" ? (
								<RecordEditor value={entry.value} busy={busy} onSave={persistJson} />
							) : (
								<pre className="max-h-40 select-text overflow-auto rounded-lg bg-[var(--well-bg)] p-2 font-mono text-xs text-[var(--text)] hairline">
									{JSON.stringify(entry.value, null, 2)}
								</pre>
							)}
							<div className="mt-1.5">
								<Button size="sm" variant="ghost" icon={Braces} onClick={() => setJsonMode(true)}>
									{t("settingsCore.ompList.editRawJson")}
								</Button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ── Sections ─────────────────────────────────────────────────────────

interface PageGroup {
	section: OmpSectionDef;
	/** Rows whose TUI condition is met. */
	visible: OmpConfigEntry[];
	/** One muted hint per unmet condition, e.g. 「选择 Hindsight 记忆后端后显示 9 项」. */
	hints: string[];
}

function usePageGroups(page: OmpHostPage, slot: string | undefined, only: readonly string[] | undefined): PageGroup[] {
	const { t, locale } = useT();
	const entries = useOmpConfigStore((s) => s.entries);
	return useMemo(() => {
		const byKey = new Map(entries.map((e) => [e.key, e.value] as const));
		const valueOf = (key: string) => byKey.get(key);
		const result: PageGroup[] = [];
		for (const g of groupEntriesForPage(entries, page, slot)) {
			if (only && !only.includes(g.section.id)) continue;
			const visible: OmpConfigEntry[] = [];
			const hidden = new Map<string, number>();
			for (const e of g.entries) {
				if (ompConditionMet(e.key, valueOf)) {
					visible.push(e);
				} else {
					const hint = ompConditionHint(e.key, locale) ?? t("settingsCore.ompCondition.defaultPrefix");
					hidden.set(hint, (hidden.get(hint) ?? 0) + 1);
				}
			}
			const hints = [...hidden].map(([hint, n]) => t("settingsCore.ompCondition.itemsSuffix", { hint, count: n }));
			if (visible.length > 0 || hints.length > 0) result.push({ section: g.section, visible, hints });
		}
		return result;
	}, [entries, page, slot, only, t, locale]);
}

/** Loads the omp config once; renders a status block while loading / failed, else null. */
function useConfigGate(): ReactNode | null {
	const { t } = useT();
	const loading = useOmpConfigStore((s) => s.loading);
	const loaded = useOmpConfigStore((s) => s.loaded);
	const error = useOmpConfigStore((s) => s.error);
	const load = useOmpConfigStore((s) => s.load);
	useEffect(() => {
		void load();
	}, [load]);
	if (loaded) return null;
	if (error) {
		return (
			<Notice
				tone="danger"
				title={t("settingsCore.ompList.loadOmpErrorTitle")}
				action={
					<div className="flex gap-2">
						<Button size="sm" icon={Download} onClick={() => void useOmpInstall.getState().openAndInstall()}>
							{t("settingsCore.ompList.installKernel")}
						</Button>
						<Button size="sm" icon={RefreshCw} onClick={() => void load(true)}>
							{t("settingsCore.ompList.retry")}
						</Button>
					</div>
				}
			>
				<span className="select-text break-all">{error}</span>
				<span className="mt-1 block">{t("settingsCore.ompList.loadOmpErrorHint")}</span>
			</Notice>
		);
	}
	if (loading) return <EmptyState icon={RefreshCw} spin title={t("settingsCore.ompList.loadingOmp")} />;
	return null;
}

/** All sections of one omp page (or slot) as cards; null when nothing is visible. */
export function OmpSections({ page, slot, only }: { page: OmpHostPage; slot?: string; only?: readonly string[] }) {
	const { t, locale } = useT();
	const gate = useConfigGate();
	const groups = usePageGroups(page, slot, only);
	const project = useProjectLayer();

	const overriddenCount = useMemo(() => {
		let n = 0;
		let path = "";
		for (const g of groups) {
			for (const e of g.visible) {
				const o = project.overrideFor(e.key);
				if (o) {
					n += 1;
					path = o.path;
				}
			}
		}
		return { n, path };
	}, [groups, project]);

	if (gate) return gate;
	if (groups.length === 0) return null;

	return (
		<ProjectLayerContext.Provider value={project}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: delegates row keyboard navigation */}
			<div className="space-y-5" onKeyDown={handleRowKeys}>
				{overriddenCount.n > 0 && (
					<Notice tone="info">
						<span title={overriddenCount.path}>
							{t("settingsCore.ompList.projectNotice", { count: overriddenCount.n })}
						</span>
					</Notice>
				)}
				{groups.map((g) => {
					const secTitle = ompSectionTitle(g.section, locale);
					return (
						<div key={g.section.id} data-jump={secTitle} className="scroll-mt-4">
							<SettingsCard title={secTitle} aside={g.section.tui} description={g.section.description}>
								{g.visible.map((entry) => (
									<OmpSettingRow key={entry.key} entry={entry} />
								))}
								{g.hints.map((hint) => (
									<div key={hint} className="px-4 py-2.5 text-xs text-[var(--text-dim)]">
										{hint}
									</div>
								))}
							</SettingsCard>
						</div>
					);
				})}
			</div>
		</ProjectLayerContext.Provider>
	);
}

/** Pure omp page: header, jump chips (≥ 4 sections, omp groups plus any `lead`/`children` anchors) and the sections. */
export function OmpSettingsPage({
	page,
	title,
	description,
	lead,
	children,
}: {
	page: OmpHostPage;
	title: string;
	description: string;
	/** Rendered right under the header, before the config sections. */
	lead?: ReactNode;
	/** Rendered after the config sections. */
	children?: ReactNode;
}) {
	return (
		<div className="space-y-5">
			<SectionHeader title={title} description={description} />
			<SectionJumpBar />
			{lead}
			<OmpSections page={page} />
			{children}
		</div>
	);
}
