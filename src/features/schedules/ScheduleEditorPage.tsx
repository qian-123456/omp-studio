import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
	AlertCircle,
	Check,
	CheckCircle2,
	ChevronDown,
	Clock,
	ExternalLink,
	FolderOpen,
	GitBranch,
	Info,
	Loader2,
	Minus,
	Plus,
	ShieldCheck,
	XCircle,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ReactNode, Ref } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { ModelSelect } from "../../components/ModelSelect";
import { useT } from "../../stores/language";
import {
	composeSelection,
	parseSelection,
} from "../../components/modelSelectLogic";
import { ThinkingLevelPicker } from "../../components/ThinkingLevelPicker";
import type {
	Schedule,
	ScheduleDraft,
	ScheduleNotify,
	ScheduleRun,
	WorktreeInfo,
} from "../../lib/contracts";
import { confirmDialog } from "../../lib/dialogs";
import { absoluteTime } from "../../lib/format";
import { formatRelativeTime } from "./humanCadence";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { gitListWorktrees, gitRepoRoot } from "../../lib/ipc";
import { resolveThinkingLevels, toModelKey } from "../../lib/models";
import { basename, trimTrailingSlash } from "../../lib/paths";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "../sessions/sidebarStore";
import { Switch } from "../settings/Switch";
import {
	CADENCE_UNITS,
	MONTH_DAYS,
	WEEKDAY_CHIPS,
	buildDraft,
	defaultForm,
	formatRunDuration,
	formFromSchedule,
	formFromTemplate,
	localTimezoneLabel,
	presetOfForm,
	timeSlotOptions,
	toLocalDateValue,
	toLocalInputValue,
	validateForm,
} from "./scheduleUtils";
import type { CadencePreset, EditorForm } from "./scheduleUtils";
import { insertImages, removeImage } from "../backlog/ideaTokens";
import { ImageThumbs, useImageAttach } from "../backlog/IdeaImages";
import { docToPrompt, promptToDoc } from "./promptImages";
import { type EditorTab, useSchedulesStore } from "./schedulesStore";

/** Stable empty list so the zustand selector never returns a fresh array. */
const EMPTY_RUNS: ScheduleRun[] = [];

function getRunStatusLabel(status: ScheduleRun["status"], t: (k: string) => string): string {
	switch (status) {
		case "running":
			return t("schedules.runStatusRunning");
		case "ok":
			return t("schedules.runStatusOk");
		case "error":
			return t("schedules.runStatusError");
		case "skipped":
			return t("schedules.runStatusSkipped");
	}
}

interface Props {
	onClose: () => void;
	editingSchedule: Schedule | null;
	template?: Partial<ScheduleDraft> | null;
	/** Which tab to open on (history when a run just failed). */
	initialTab?: EditorTab;
	onSave: (draft: ScheduleDraft) => Promise<Schedule | null>;
}

const INPUT_CLASS =
	"w-full h-9 px-3 rounded-2xl bg-[var(--bg)] hairline-outset text-[var(--text)] placeholder:text-[var(--text-30,var(--text-dim))] text-xs focus:outline-none focus:ring-1 focus:ring-[var(--hairline-strong)] transition-shadow";

/** Ghost pill button used by the composer toolbar pickers. */
const TOOLBAR_CHIP_CLASS =
	"flex select-none items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]";

/** Skin shared by every dropdown menu on this page (rounded-2xl, hairline). */
const MENU_CLASS =
	"!rounded-2xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] p-1.5";

/** The single open dropdown menu; null = all closed. */
type MenuId =
	| "preset"
	| "unit"
	| "time"
	| "monthDay"
	| "endMode"
	| "workspace"
	| "approval"
	| "thinking"
	| "notify"
	| "runMode"
	| "worktree";

/** Approval-mode dropdown rows (values match the backend `--approval-mode`). */
const APPROVAL_OPTIONS = [
	{
		value: "always-ask",
		labelKey: "schedules.approvalAlwaysAsk",
		descKey: "schedules.approvalAlwaysAskDesc",
	},
	{
		value: "write",
		labelKey: "schedules.approvalWrite",
		descKey: "schedules.approvalWriteDesc",
	},
	{
		value: "yolo",
		labelKey: "schedules.approvalYolo",
		descKey: "schedules.approvalYoloDesc",
	},
] as const;

function approvalLabel(value: string, t: (k: string) => string): string {
	const opt = APPROVAL_OPTIONS.find((o) => o.value === value);
	return opt ? t(opt.labelKey) : (value || t("schedules.approvalFollowDefault"));
}

/** 收件箱通知 options — which finished runs create an inbox entry. */
const NOTIFY_OPTIONS: { value: ScheduleNotify; labelKey: string; descKey: string }[] =
	[
		{
			value: "important",
			labelKey: "schedules.notifyImportant",
			descKey: "schedules.notifyImportantDesc",
		},
		{
			value: "all",
			labelKey: "schedules.notifyAll",
			descKey: "schedules.notifyAllDesc",
		},
		{
			value: "none",
			labelKey: "schedules.notifyNone",
			descKey: "schedules.notifyNoneDesc",
		},
	];

const PRESET_MENU: {
	value: Exclude<CadencePreset, "once" | "custom">;
	labelKey: string;
}[] = [
	{ value: "hourly", labelKey: "schedules.presetHourly" },
	{ value: "daily", labelKey: "schedules.presetDaily" },
	{ value: "weekdays", labelKey: "schedules.presetWeekdays" },
	{ value: "weekly", labelKey: "schedules.presetWeekly" },
	{ value: "monthly", labelKey: "schedules.presetMonthly" },
];

export function ScheduleEditorPage({
	onClose,
	editingSchedule,
	template,
	initialTab = "settings",
	onSave,
}: Props) {
	const { t, locale } = useT();
	const workspaces = useSessions((s) => s.workspaces);
	// Spaces are isolated: the editor only offers the active mode's workspaces.
	const activeMode = useSidebarStore((s) => s.activeMode);
	const modeWorkspaces = useMemo(
		() => workspaces.filter((w) => w.mode === activeMode),
		[workspaces, activeMode],
	);
	const selectSession = useUi((s) => s.selectSession);
	const runs = useSchedulesStore((s) =>
		editingSchedule ? (s.runs[editingSchedule.id] ?? EMPTY_RUNS) : EMPTY_RUNS,
	);
	const loadRuns = useSchedulesStore((s) => s.loadRuns);
	const markRunSeen = useSchedulesStore((s) => s.markRunSeen);

	const [tab, setTab] = useState<EditorTab>("settings");
	const [form, setForm] = useState<EditorForm>(() => defaultForm(""));
	const [initialSnapshot, setInitialSnapshot] = useState("");
	/** Main repo root of `form.cwd` (resolves linked worktrees); null = not a repo. */
	const [repoRoot, setRepoRoot] = useState<string | null>(null);
	const isGitRepo = repoRoot !== null;
	const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	/** true once the user picks 自定义 — reveals the `每 N unit` composer row. */
	const [customOpen, setCustomOpen] = useState(false);
	const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
	const [submitAttempted, setSubmitAttempted] = useState(false);
	const [saving, setSaving] = useState(false);
	const promptRef = useRef<HTMLTextAreaElement>(null);
	const workspaceMenuRef = useRef<HTMLDivElement>(null);
	const approvalMenuRef = useRef<HTMLDivElement>(null);
	const scheduleCardRef = useRef<HTMLDivElement>(null);
	const worktreeMenuRef = useRef<HTMLDivElement>(null);
	const repeatPillRef = useRef<HTMLButtonElement>(null);

	const toggleMenu = (id: MenuId) =>
		setOpenMenu((v) => (v === id ? null : id));

	const availableModels = useModelOptions();
	const tzLabel = useMemo(() => localTimezoneLabel(), []);

	const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);

	// Initialize form + tab on mount / schedule change
	useEffect(() => {
		const next = editingSchedule
			? formFromSchedule(editingSchedule)
			: template
				? formFromTemplate(
						template,
						modeWorkspaces.find((w) => w.kind === "project")?.path ?? "",
					)
				: defaultForm(modeWorkspaces.find((w) => w.kind === "project")?.path ?? "");
		setForm(next);
		setInitialSnapshot(JSON.stringify(next));
		setTab(editingSchedule ? initialTab : "settings");
		setAdvancedOpen(false);
		setCustomOpen(false);
		setOpenMenu(null);
		setSubmitAttempted(false);
	}, [editingSchedule, template, modeWorkspaces, initialTab]);

	// Load run history when an existing task's history tab is shown; mark the
	// newest run seen so the unread dot clears.
	useEffect(() => {
		if (!editingSchedule || tab !== "history") return;
		void loadRuns(editingSchedule.id);
	}, [editingSchedule, tab, loadRuns]);

	const topRunId = runs[0]?.id;
	useEffect(() => {
		if (tab === "history" && topRunId) markRunSeen(topRunId);
	}, [tab, topRunId, markRunSeen]);

	// Resolve the repo behind cwd: gates worktree run mode and keeps the
	// workspace chip on the project when cwd is one of its linked worktrees.
	useEffect(() => {
		const cwd = form.cwd.trim();
		if (!cwd) {
			setRepoRoot(null);
			return;
		}
		let active = true;
		gitRepoRoot(cwd)
			.then((root) => {
				if (active) {
					setRepoRoot(root ?? null);
					if (!root) {
						setForm((f) =>
							f.runMode === "worktree" ? { ...f, runMode: "local" } : f,
						);
					}
				}
			})
			.catch(() => {
				if (active) setRepoRoot(null);
			});
		return () => {
			active = false;
		};
	}, [form.cwd]);

	useEffect(() => {
		if (!repoRoot) {
			setWorktrees([]);
			return;
		}
		let active = true;
		gitListWorktrees(repoRoot)
			.then((list) => {
				if (active) setWorktrees(list);
			})
			.catch(() => {
				if (active) setWorktrees([]);
			});
		return () => {
			active = false;
		};
	}, [repoRoot]);

	const isDirty = JSON.stringify(form) !== initialSnapshot;

	const onceAtUnchanged =
		editingSchedule?.cadence.kind === "once" &&
		form.onceAt !== "" &&
		form.onceAt ===
			toLocalInputValue(
				editingSchedule.cadence.kind === "once"
					? editingSchedule.cadence.at
					: null,
			);

	const { cadence, endAt, maxRuns, errors } = useMemo(
		() => validateForm(form, { onceAtUnchanged }),
		[form, onceAtUnchanged],
	);

	/** A `once` task whose time was (re)set to the future must be enabled or it
	 * can never fire — including completed and deliberately-paused tasks. */
	const onceRescheduled = cadence?.kind === "once" && !onceAtUnchanged;

	const confirmingRef = useRef(false);
	const requestClose = useCallback(async () => {
		if (!isDirty) {
			onClose();
			return;
		}
		if (confirmingRef.current) return;
		confirmingRef.current = true;
		try {
			const discard = await confirmDialog(
				t("schedules.discardMsg"),
				{
					title: t("schedules.discardTitle"),
					okLabel: t("schedules.discardOk"),
					cancelLabel: t("schedules.discardCancel"),
					danger: true,
				},
			);
			if (discard) onClose();
		} finally {
			confirmingRef.current = false;
		}
	}, [isDirty, onClose]);

	useEscapeKey(
		() => void requestClose(),
		openMenu === null,
	);

	const handleSubmit = useCallback(async () => {
		setSubmitAttempted(true);
		if (!cadence || errors.prompt || errors.cwd || errors.endAt || errors.maxRuns) {
			// A bad/empty cwd surfaces on the toolbar workspace picker + its error text.
			if (errors.cwd) setOpenMenu("workspace");
			return;
		}
		setSaving(true);
		try {
			const draft = buildDraft(
				form,
				cadence,
				endAt,
				maxRuns,
				editingSchedule?.id,
				// New tasks start enabled; a `once` rescheduled to the future is
				// re-enabled so it can fire; recurring tasks keep their pause state.
				editingSchedule ? editingSchedule.enabled || onceRescheduled : true,
			);
			const saved = await onSave(draft);
			if (saved) onClose();
		} finally {
			setSaving(false);
		}
	}, [cadence, endAt, maxRuns, form, editingSchedule, onSave, onClose, errors, onceRescheduled]);

	const handleBrowseCwd = async () => {
		try {
			const sel = await openDialog({ directory: true, multiple: false });
			if (typeof sel === "string") set("cwd", sel);
		} catch (e) {
			console.error("Browse directory failed:", e);
		}
	};

	const openRunSession = (run: ScheduleRun) => {
		markRunSeen(run.id);
		if (run.sessionId) {
			selectSession(run.sessionId);
			onClose();
		}
	};

	// Auto-height the instructions textarea as the user types.
	const resizePrompt = () => {
		const el = promptRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
	};
	useEffect(() => {
		if (tab === "settings") resizePrompt();
	}, [tab, form.prompt]);

	// Error visibility: required-text fields show errors only after a submit
	// attempt (empty new forms stay quiet); cadence/end errors show when the
	// relevant input actually holds an invalid value.
	const promptErr = submitAttempted ? errors.prompt : undefined;
	const promptDoc = useMemo(() => promptToDoc(form.prompt), [form.prompt]);
	const imageAttach = useImageAttach((paths) => {
		const el = promptRef.current;
		const cur = promptToDoc(form.prompt);
		const r = insertImages(cur, el?.selectionStart ?? cur.text.length, paths);
		set("prompt", docToPrompt(r.doc));
	});
	const cwdErr = submitAttempted ? errors.cwd : undefined;
	const cadenceErr =
		submitAttempted ||
		(form.hasSchedule &&
			((form.repeat === "once" && form.onceAt !== "") ||
				(form.repeat === "recur" &&
					form.unit === "week" &&
					form.weekdays.length === 0)))
			? errors.cadence
			: undefined;
	const endErr =
		submitAttempted ||
		(form.repeat === "recur" &&
			form.endMode === "date" &&
			form.endDate !== "")
			? errors.endAt
			: undefined;
	const runsErr =
		submitAttempted ||
		(form.repeat === "recur" && form.endMode === "count" && form.endRuns < 1)
			? errors.maxRuns
			: undefined;

	// Composer toolbar state: workspace / permission / model / thinking.
	const modelSel = parseSelection(form.modelSel);
	const selectedModel =
		availableModels?.find(
			(m) => toModelKey(m.provider, m.id) === modelSel.selector,
		) ?? null;
	const thinkingLevels = resolveThinkingLevels(
		null,
		selectedModel?.thinking ?? null,
		modelSel.level,
	);
	const modelLabel = modelSel.selector
		? (selectedModel?.id ?? modelSel.selector)
		: t("schedules.defaultModel");
	const pickThinkingLevel = (level: string) => {
		set(
			"modelSel",
			level === "auto"
				? modelSel.selector
				: composeSelection(modelSel.selector, level),
		);
		setOpenMenu(null);
	};

	const cwdKey = trimTrailingSlash(form.cwd);
	const selectedWorkspace =
		modeWorkspaces.find((w) => trimTrailingSlash(w.path) === cwdKey) ??
		(repoRoot
			? (modeWorkspaces.find(
					(w) => trimTrailingSlash(w.path) === trimTrailingSlash(repoRoot),
				) ?? null)
			: null);
	const workspaceLabel = selectedWorkspace
		? selectedWorkspace.name
		: form.cwd
			? basename(form.cwd)
			: t("schedules.selectDir");
	const customCwd = form.cwd && !selectedWorkspace ? form.cwd : null;
	const currentWorktree =
		worktrees.find((wt) => trimTrailingSlash(wt.path) === cwdKey) ?? null;
	const worktreeName = (wt: WorktreeInfo) => wt.branch ?? basename(wt.path);
	const isMainWorktree = (wt: WorktreeInfo) =>
		repoRoot !== null && trimTrailingSlash(wt.path) === trimTrailingSlash(repoRoot);
	const worktreeLabel =
		form.runMode === "worktree"
			? t("schedules.newWorktree")
			: currentWorktree
				? worktreeName(currentWorktree)
				: t("schedules.worktreeTitle");

	/** The named preset the current `每 N unit` model matches, else "自定义". */
	const activePreset = presetOfForm(form);
	const cadenceLabel =
		activePreset === "once"
			? t("schedules.presetOnce")
			: activePreset === "custom"
				? t("schedules.presetCustom")
				: (PRESET_MENU.find((o) => o.value === activePreset)?.labelKey
					? t(PRESET_MENU.find((o) => o.value === activePreset)!.labelKey)
					: t("schedules.presetCustom"));
	/** The `每 N unit` composer row: revealed by 自定义 or a non-preset model. */
	const composerVisible = customOpen || activePreset === "custom";

	/** "添加计划"/周期 preset picked: fill the recurring model (once = date-time row). */
	const applyPreset = (preset: CadencePreset) => {
		setOpenMenu(null);
		setCustomOpen(preset === "custom");
		switch (preset) {
			case "once":
				setForm((f) => ({ ...f, hasSchedule: true, repeat: "once" }));
				break;
			case "hourly":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
					every: 1,
					unit: "hour",
				}));
				break;
			case "daily":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
					every: 1,
					unit: "day",
				}));
				break;
			case "weekdays":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
					every: 1,
					unit: "week",
					weekdays: [1, 2, 3, 4, 5],
				}));
				break;
			case "weekly":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
					every: 1,
					unit: "week",
					// Mon-Fri is the 每工作日 preset; keeping it would leave the label stuck there.
					weekdays:
						f.weekdays.length > 0 &&
						f.weekdays.length < 7 &&
						!(
							f.weekdays.length === 5 &&
							[1, 2, 3, 4, 5].every((d) => f.weekdays.includes(d))
						)
							? f.weekdays
							: [1],
				}));
				break;
			case "monthly":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
					every: 1,
					unit: "month",
				}));
				break;
			case "custom":
				setForm((f) => ({
					...f,
					hasSchedule: true,
					repeat: "recur",
				}));
				break;
		}
	};

	/** Shared items of the 周期 dropdown (+ 清除计划 once a cadence exists). */
	const cadenceMenuItems = (
		<>
			<MenuHeader>{t("schedules.cadenceMenuHeader")}</MenuHeader>
			{PRESET_MENU.map((p) => (
				<MenuItem
					key={p.value}
					selected={!composerVisible && activePreset === p.value}
					onClick={() => applyPreset(p.value)}
				>
					{t(p.labelKey)}
				</MenuItem>
			))}
			<MenuItem
				selected={composerVisible}
				onClick={() => applyPreset("custom")}
			>
				{t("schedules.presetCustom")}
			</MenuItem>
			<MenuDivider />
			<MenuItem
				selected={activePreset === "once"}
				onClick={() => applyPreset("once")}
			>
				{t("schedules.presetOnceOnly")}
			</MenuItem>
			{form.hasSchedule && (
				<>
					<MenuDivider />
					<MenuItem
						onClick={() => {
							setOpenMenu(null);
							set("hasSchedule", false);
						}}
					>
						{t("schedules.clearCadence")}
					</MenuItem>
				</>
			)}
		</>
	);

	return (
		<div
			className="flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]"
			onKeyDown={(e) => {
				if (
					(e.metaKey || e.ctrlKey) &&
					e.key === "Enter" &&
					!isComposing(e) &&
					tab === "settings"
				) {
					e.preventDefault();
					void handleSubmit();
				}
			}}
		>
			{tab === "history" && editingSchedule ? (
				/* ---- History tab ---- */
				<div className="flex-1 overflow-y-auto">
					<div className="mx-auto max-w-[880px] px-8 py-6">
						<div className="mt-1">
							<h1 className="text-lg font-semibold text-[var(--text)]">
								{editingSchedule.name || t("schedules.placeholderTitle")}
							</h1>
							<p className="mt-1 text-xs text-[var(--text-60,var(--text-muted))]">
								{t("schedules.historySubtitle")}
							</p>
						</div>

						<div className="mt-5 flex items-center justify-between gap-3">
							<PillTabs<EditorTab>
								aria-label={t("schedules.tabViewAria")}
								value={tab}
								onChange={setTab}
								options={[
									{ value: "settings", label: t("schedules.tabSettings") },
									{ value: "history", label: t("schedules.tabHistory") },
								]}
							/>
						</div>

						<div className="mt-6">
							{runs.length === 0 ? (
								<div className="py-16 text-center space-y-1.5">
									<div className="mx-auto w-9 h-9 rounded-full bg-neutral-500/10 border border-[var(--border-divider)] flex items-center justify-center text-neutral-500">
										<Clock size={16} />
									</div>
									<p className="text-xs text-neutral-400">{t("schedules.noRunHistory")}</p>
								</div>
							) : (
								<div className="space-y-1.5">
									{runs.map((r) => (
										<button
											key={r.id}
											type="button"
											disabled={!r.sessionId}
											onClick={() => openRunSession(r)}
											className={clsx(
												"w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] text-left text-xs transition-colors",
												r.sessionId
													? "hover:bg-[var(--bg-hover)] cursor-pointer"
													: "cursor-default",
											)}
											title={
												r.sessionId
													? t("schedules.openSessionInWorkbench")
													: t("schedules.runHasNoSession")
											}
										>
											<RunStatusIcon status={r.status} />
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span
														className={clsx(
															"font-medium",
															r.status === "ok"
																? "text-emerald-400"
																: r.status === "error"
																	? "text-rose-400"
																	: r.status === "running"
																		? "text-sky-400"
																		: "text-amber-400",
														)}
													>
														{getRunStatusLabel(r.status, t)}
													</span>
													<span
														className="text-neutral-400"
														title={formatRelativeTime(r.startedAt, locale)}
													>
														{absoluteTime(r.startedAt)}
													</span>
													<span className="text-neutral-500">
														{formatRunDuration(r)}
													</span>
												</div>
												{r.summary && (
													<div className="mt-0.5 truncate text-[11px] text-neutral-400">
														{r.summary}
													</div>
												)}
											</div>
											{r.sessionId && (
												<ExternalLink
													size={12}
													className="shrink-0 text-neutral-500"
												/>
											)}
										</button>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			) : (
				/* ---- Settings tab ---- */
				<div className="flex-1 overflow-y-auto">
					<div className="mx-auto max-w-[880px] px-8 pb-12 pt-6">
						<h1 className="mt-1 text-lg font-semibold text-[var(--text)]">
							{editingSchedule ? t("schedules.editTitle") : t("schedules.createTitle")}
						</h1>
						<p className="mt-1 text-xs text-[var(--text-60,var(--text-muted))]">
							{t("schedules.editorSubtitle")}
						</p>

						{/* Tabs + primary action on one row */}
						<div className="mt-5 flex items-center justify-between gap-3">
							<PillTabs<EditorTab>
								aria-label={t("schedules.tabViewAria")}
								value={tab}
								onChange={setTab}
								options={[
									{ value: "settings", label: t("schedules.tabSettings") },
									{
										value: "history",
										label: t("schedules.tabHistory"),
										disabled: !editingSchedule,
										title: editingSchedule
											? undefined
											: t("schedules.tabHistoryDisabledTitle"),
									},
								]}
							/>
							<button
								type="button"
								onClick={() => void handleSubmit()}
								disabled={saving}
								title="⌘/Ctrl+Enter"
								className="flex items-center gap-1.5 rounded-full bg-[var(--text)] px-4 py-2 text-xs font-semibold text-[var(--bg)] shadow-sm transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving && <Loader2 size={13} className="animate-spin" />}
								<span>{editingSchedule ? t("schedules.saveChanges") : t("schedules.createSchedule")}</span>
							</button>
						</div>


						{/* 任务标题 */}
						<section className="mt-6">
							<FieldLabel>{t("schedules.fieldTitle")}</FieldLabel>
							<input
								type="text"
								placeholder={t("schedules.placeholderTitle")}
								value={form.name}
								onChange={(e) => set("name", e.target.value)}
								className={INPUT_CLASS}
							/>
							<p className="mt-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
								{t("schedules.titleHint")}
							</p>
						</section>

						{/* 周期 */}
						<section className="mt-6">
							<FieldLabel>{t("schedules.fieldCadence")}</FieldLabel>
							<div
								ref={scheduleCardRef}
								className="rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] shadow-sm"
							>
								{!form.hasSchedule ? (
									<button
										type="button"
										onClick={() => toggleMenu("preset")}
										aria-expanded={openMenu === "preset"}
										className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-[var(--text-60,var(--text-muted))] transition-colors hover:text-[var(--text)]"
									>
										<Plus size={14} className="shrink-0" />
										<span>{t("schedules.addCadence")}</span>
									</button>
								) : (
									<div className="divide-y divide-[var(--line)]">
										{/* 周期 — preset dropdown */}
										<CardRow label={t("schedules.fieldCadence")}>
											<PillButton
												ref={repeatPillRef}
												open={openMenu === "preset"}
												onClick={() => toggleMenu("preset")}
											>
												{cadenceLabel}
											</PillButton>
										</CardRow>

										{/* 每 N 单位 — the composer; revealed by 自定义 or any non-preset model */}
										{form.repeat === "recur" && composerVisible && (
											<CardRow label={t("schedules.everyPrefix")}>
												<NumberStepper
													value={form.every}
													min={form.unit === "minute" ? 5 : 1}
													onChange={(v) => set("every", v)}
													ariaLabel={t("schedules.repeatInterval")}
												/>
												<PillMenu
													id="unit"
													openMenu={openMenu}
													onToggle={toggleMenu}
													label={
														CADENCE_UNITS.find(
															(u) => u.value === form.unit,
														)?.labelKey ? t(CADENCE_UNITS.find((u) => u.value === form.unit)!.labelKey) : ""
													}
													menuClassName="w-32"
												>
													{CADENCE_UNITS.map((u) => (
														<MenuItem
															key={u.value}
															selected={form.unit === u.value}
															onClick={() => {
																setOpenMenu(null);
																setForm((f) => ({
																	...f,
																	unit: u.value,
																	// 分钟 cadences need >= 5.
																	every:
																		u.value === "minute"
																			? Math.max(5, f.every)
																			: f.every,
																}));
															}}
														>
															{t(u.labelKey)}
														</MenuItem>
													))}
												</PillMenu>
												{form.unit === "minute" && (
													<span className="text-[11px] text-[var(--text-40,var(--text-dim))]">
														{t("schedules.atLeast5")}
													</span>
												)}
											</CardRow>
										)}

										{/* 时间 (day / week / month units) */}
										{form.repeat === "recur" &&
											(form.unit === "day" ||
												form.unit === "week" ||
												form.unit === "month") && (
												<CardRow label={t("schedules.fieldTime")}>
													<PillMenu
														id="time"
														openMenu={openMenu}
														onToggle={toggleMenu}
														label={form.time}
														menuClassName="w-36"
													>
														{timeSlotOptions(form.time).map((t) => (
															<MenuItem
																key={t}
																selected={form.time === t}
																onClick={() => {
																	setOpenMenu(null);
																	set("time", t);
																}}
															>
																{t}
															</MenuItem>
														))}
													</PillMenu>
													<span className="truncate text-[11px] text-[var(--text-40,var(--text-dim))]">
														{tzLabel}
													</span>
												</CardRow>
											)}

										{/* 星期 chips (week unit) */}
										{form.repeat === "recur" && form.unit === "week" && (
											<CardRow label={t("schedules.fieldWeekday")}>
												<div className="flex gap-1">
													{WEEKDAY_CHIPS.map((w) => {
														const on = form.weekdays.includes(w.id);
														return (
															<button
																key={w.id}
																type="button"
																onClick={() =>
																	set(
																		"weekdays",
																		on
																			? form.weekdays.filter(
																					(d) => d !== w.id,
																				)
																			: [...form.weekdays, w.id].sort(
																					(a, b) => a - b,
																				),
																	)
																}
																className={clsx(
																	"h-6 w-6 rounded-full border text-[11px] transition-colors",
																	on
																		? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"
																		: "border-[var(--line,var(--border-divider))] bg-[var(--bg)] text-[var(--text-40,var(--text-dim))] hover:text-[var(--text)]",
																)}
															>
																{locale === "en-US" ? w.labelEn : w.label}
															</button>
														);
													})}
												</div>
											</CardRow>
										)}

										{/* 日期 (month unit, 1-31; short months clamp) */}
										{form.repeat === "recur" && form.unit === "month" && (
											<CardRow label={t("schedules.fieldMonthDay")}>
												<PillMenu
													id="monthDay"
													openMenu={openMenu}
													onToggle={toggleMenu}
													label={t("schedules.dayUnit", { day: form.monthDay })}
													menuClassName="w-32"
												>
													{MONTH_DAYS.map((d) => (
														<MenuItem
															key={d}
															selected={form.monthDay === d}
															onClick={() => {
																setOpenMenu(null);
																set("monthDay", d);
															}}
														>
															{t("schedules.dayUnit", { day: d })}
														</MenuItem>
													))}
												</PillMenu>
												{form.monthDay > 28 && (
													<span className="text-[11px] text-[var(--text-40,var(--text-dim))]">
														{t("schedules.shortMonthClampHint")}
													</span>
												)}
											</CardRow>
										)}

										{/* 执行时间 (不重复/仅一次) */}
										{form.repeat === "once" && (
											<CardRow label={t("schedules.fieldRunTime")}>
												<input
													type="datetime-local"
													value={form.onceAt}
													onChange={(e) => set("onceAt", e.target.value)}
													className="h-7 rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--bg)] px-2.5 text-xs text-[var(--text)] focus:border-[var(--hairline-strong)] focus:outline-none"
												/>
												<span className="truncate text-[11px] text-[var(--text-40,var(--text-dim))]">
													{tzLabel}
												</span>
											</CardRow>
										)}

										{/* 结束重复: 从不 / 截止日期 / 重复 N 次后 */}
										{form.repeat === "recur" && (
											<CardRow label={t("schedules.fieldEndRepeat")}>
												{form.endMode === "date" && (
													<input
														type="date"
														value={form.endDate}
														min={toLocalDateValue(
															new Date().toISOString(),
														)}
														onChange={(e) =>
															set("endDate", e.target.value)
														}
														className="h-7 rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--bg)] px-2.5 text-xs text-[var(--text)] focus:border-[var(--hairline-strong)] focus:outline-none"
													/>
												)}
												{form.endMode === "count" && (
													<NumberStepper
														value={form.endRuns}
														min={1}
														onChange={(v) => set("endRuns", v)}
														ariaLabel={t("schedules.repeatCount")}
													/>
												)}
												<PillMenu
													id="endMode"
													openMenu={openMenu}
													onToggle={toggleMenu}
													label={
														form.endMode === "date"
															? form.endDate || t("schedules.endDate")
															: form.endMode === "count"
																? Number.isFinite(
																		Math.floor(form.endRuns),
																	) && form.endRuns >= 1
																	? t("schedules.endCountLabel", { count: Math.floor(form.endRuns) })
																	: t("schedules.endCount")
																: t("schedules.endNever")
													}
													menuClassName="w-36"
												>
													<MenuItem
														selected={form.endMode === "never"}
														onClick={() => {
															setOpenMenu(null);
															set("endMode", "never");
														}}
													>
														{t("schedules.endNever")}
													</MenuItem>
													<MenuItem
														selected={form.endMode === "date"}
														onClick={() => {
															setOpenMenu(null);
															set("endMode", "date");
														}}
													>
														{t("schedules.endDate")}
													</MenuItem>
													<MenuItem
														selected={form.endMode === "count"}
														onClick={() => {
															setOpenMenu(null);
															set("endMode", "count");
														}}
													>
														{t("schedules.endCount")}
													</MenuItem>
												</PillMenu>
											</CardRow>
										)}
									</div>
								)}
							</div>

							{/* 周期 dropdown — anchors to the pill (filled) or the card (empty) */}
							{openMenu === "preset" &&
								(form.hasSchedule
									? repeatPillRef.current
									: scheduleCardRef.current) && (
									<FloatingLayer
										anchor={
											form.hasSchedule
												? repeatPillRef.current
												: scheduleCardRef.current
										}
										placement="bottom-end"
										offset={6}
										layer="popover"
										ignoreRefs={
											form.hasSchedule
												? [repeatPillRef]
												: [scheduleCardRef]
										}
										onDismiss={() => setOpenMenu(null)}
										className={clsx("w-48", MENU_CLASS)}
									>
										{cadenceMenuItems}
									</FloatingLayer>
								)}

							{/* Cadence / end errors */}
							{(cadenceErr || endErr || runsErr) && (
								<div className="mt-1.5 space-y-0.5">
									{cadenceErr && (
										<p className="text-[11px] text-rose-400">{cadenceErr}</p>
									)}
									{endErr && (
										<p className="text-[11px] text-rose-400">{endErr}</p>
									)}
									{runsErr && (
										<p className="text-[11px] text-rose-400">{runsErr}</p>
									)}
								</div>
							)}
						</section>

						{/* images: stored inline as `[Image #N: path]` in the prompt text */}
						{/* 指令 — chat-composer card: textarea + attached toolbar strip */}
						<section className="mt-6">
							<FieldLabel>{t("schedules.fieldPrompt")}</FieldLabel>
							<div
								className={clsx(
									"rounded-3xl border bg-[var(--bg-panel)] shadow-sm",
									imageAttach.dragging ? "border-[var(--accent)]" : "border-[var(--line)]",
								)}
								{...imageAttach.dropProps}
							>
								<div className="px-4 pt-3">
									<ImageThumbs
										paths={promptDoc.images}
										onRemove={(p) => {
											const r = removeImage(promptDoc, promptDoc.images.indexOf(p) + 1);
											set("prompt", docToPrompt(r));
										}}
									/>
								</div>
								<textarea
									ref={promptRef}
									rows={2}
									placeholder={t("schedules.promptPlaceholder")}
									value={promptDoc.text}
									onChange={(e) => {
										set("prompt", docToPrompt({ text: e.target.value, images: promptDoc.images }));
										resizePrompt();
									}}
									onPaste={imageAttach.onPaste}
									className="w-full min-h-[64px] resize-none bg-transparent px-4 pt-3.5 pb-2 text-[13px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-30,var(--text-dim))] outline-none focus:outline-none focus:ring-0"
								/>
								{imageAttach.fileInput}

								{/* Toolbar strip: workspace + permission (left); model +
								 * thinking (right), mirroring the chat Composer. */}
								<div className="flex items-center justify-between gap-2 rounded-b-[23px] bg-[var(--well-bg)]/40 px-2.5 py-1.5 text-[12px]">
									<div className="flex min-w-0 items-center gap-0.5">
										{/* Workspace picker */}
										<div className="relative" ref={workspaceMenuRef}>
											<button
												type="button"
												onClick={() => toggleMenu("workspace")}
												title={form.cwd || t("schedules.selectProjectDir")}
												className={TOOLBAR_CHIP_CLASS}
											>
												<FolderOpen
													size={12}
													className="shrink-0 text-[var(--text-30,var(--text-dim))]"
												/>
												<span className="max-w-36 truncate">
													{workspaceLabel}
												</span>
												<ChevronDown
													size={10}
													className="shrink-0 text-[var(--text-30,var(--text-dim))]"
												/>
											</button>
											{openMenu === "workspace" && (
												<FloatingLayer
													anchor={workspaceMenuRef.current}
													placement="top-start"
													offset={6}
													layer="popover"
													ignoreRefs={[workspaceMenuRef]}
													onDismiss={() => setOpenMenu(null)}
													className={clsx("w-[300px]", MENU_CLASS)}
												>
													<MenuHeader>{t("schedules.projectDirHeader")}</MenuHeader>
													<div className="max-h-64 overflow-y-auto">
														{modeWorkspaces.map((ws) => (
															<MenuItem
																key={ws.id}
																selected={selectedWorkspace?.id === ws.id}
																label={
																	<>
																		{ws.name}
																		{ws.kind === "global" && (
																			<span className="ml-1.5 text-[10px] font-normal text-[var(--text-40,var(--text-dim))]">
																				{t("schedules.globalScope")}
																			</span>
																		)}
																	</>
																}
																desc={ws.path}
																onClick={() => {
																	setOpenMenu(null);
																	set("cwd", ws.path);
																}}
															/>
														))}
														{customCwd && (
															<MenuItem
																selected
																label={t("schedules.customDir")}
																desc={customCwd}
																onClick={() => setOpenMenu(null)}
															/>
														)}
													</div>
													<MenuDivider />
													<MenuItem
														onClick={() => {
															setOpenMenu(null);
															void handleBrowseCwd();
														}}
													>
														<span className="flex items-center gap-2">
															<FolderOpen size={12} className="shrink-0" />
															{t("schedules.browseDir")}
														</span>
													</MenuItem>
												</FloatingLayer>
											)}
										</div>

										{/* Permission / approval-mode picker */}
										<div className="relative" ref={approvalMenuRef}>
											<button
												type="button"
												onClick={() => toggleMenu("approval")}
												title={t("schedules.approvalModeTitle")}
												className={TOOLBAR_CHIP_CLASS}
											>
												<ShieldCheck
													size={12}
													className={clsx(
														"shrink-0",
														form.approvalMode === "yolo"
															? "text-amber-400"
															: "text-[var(--text-30,var(--text-dim))]",
													)}
												/>
												<span
													className={clsx(
														"truncate",
														form.approvalMode === "yolo" && "text-amber-400",
													)}
												>
													{approvalLabel(form.approvalMode, t)}
												</span>
												<ChevronDown
													size={10}
													className="shrink-0 text-[var(--text-30,var(--text-dim))]"
												/>
											</button>
											{openMenu === "approval" && (
												<FloatingLayer
													anchor={approvalMenuRef.current}
													placement="top-start"
													offset={6}
													layer="popover"
													ignoreRefs={[approvalMenuRef]}
													onDismiss={() => setOpenMenu(null)}
													className={clsx("w-[280px]", MENU_CLASS)}
												>
													<MenuHeader>{t("schedules.approvalModeHeader")}</MenuHeader>
													{APPROVAL_OPTIONS.map((o) => (
														<MenuItem
															key={o.value}
															selected={form.approvalMode === o.value}
															label={t(o.labelKey)}
															desc={t(o.descKey)}
															onClick={() => {
																setOpenMenu(null);
																set("approvalMode", o.value);
															}}
														/>
													))}
												</FloatingLayer>
											)}
										</div>

										{/* Worktree picker: run in an existing worktree of the
										 * repo, or isolate each run in a fresh one. */}
										{isGitRepo && (
											<div className="relative" ref={worktreeMenuRef}>
												<button
													type="button"
													onClick={() => toggleMenu("worktree")}
													title={
														form.runMode === "worktree"
															? t("schedules.worktreeRunTitle")
															: form.cwd
													}
													className={TOOLBAR_CHIP_CLASS}
												>
													<GitBranch
														size={12}
														className="shrink-0 text-[var(--text-30,var(--text-dim))]"
													/>
													<span className="max-w-36 truncate">{worktreeLabel}</span>
													<ChevronDown
														size={10}
														className="shrink-0 text-[var(--text-30,var(--text-dim))]"
													/>
												</button>
												{openMenu === "worktree" && (
													<FloatingLayer
														anchor={worktreeMenuRef.current}
														placement="top-start"
														offset={6}
														layer="popover"
														ignoreRefs={[worktreeMenuRef]}
														onDismiss={() => setOpenMenu(null)}
														className={clsx("w-[320px]", MENU_CLASS)}
													>
														<MenuHeader>{t("schedules.worktreeHeader")}</MenuHeader>
														<div className="max-h-64 overflow-y-auto">
															{worktrees.map((wt) => (
																<MenuItem
																	key={wt.path}
																	selected={
																		form.runMode !== "worktree" &&
																		currentWorktree?.path === wt.path
																	}
																	label={
																		<>
																			{worktreeName(wt)}
																			{isMainWorktree(wt) && (
																				<span className="ml-1.5 text-[10px] font-normal text-[var(--text-40,var(--text-dim))]">
																					{t("schedules.mainDir")}
																				</span>
																			)}
																		</>
																	}
																	desc={wt.path}
																	onClick={() => {
																		setOpenMenu(null);
																		setForm((f) => ({
																			...f,
																			cwd: wt.path,
																			runMode: "local",
																		}));
																	}}
																/>
															))}
														</div>
														<MenuDivider />
														<MenuItem
															selected={form.runMode === "worktree"}
															label={t("schedules.newWorktreeOption")}
															desc={t("schedules.newWorktreeDesc")}
															onClick={() => {
																setOpenMenu(null);
																setForm((f) => ({
																	...f,
																	runMode: "worktree",
																	newChatEachRun: true,
																}));
															}}
														/>
													</FloatingLayer>
												)}
											</div>
										)}
									</div>

									<div className="flex items-center gap-0.5">
										{/* Model picker */}
										<ModelSelect
											label={modelLabel}
											models={availableModels}
											currentValue={modelSel.selector}
											onSelect={(val) => set("modelSel", val)}
											extras={[{ value: "", label: t("schedules.useDefaultModel") }]}
											buttonClass={clsx(TOOLBAR_CHIP_CLASS, "max-w-40")}
											widthClass="w-[380px]"
											direction="up"
											align="end"
										/>

										{/* Thinking chip: levels of the selected model, or a grey 未配置/不支持 chip */}
										<ThinkingLevelPicker
											levels={thinkingLevels}
											reasoning={selectedModel?.reasoning}
											value={modelSel.level ?? "auto"}
											open={openMenu === "thinking"}
											onOpenChange={(v) => setOpenMenu(v ? "thinking" : null)}
											onSelect={pickThinkingLevel}
										/>
									</div>
								</div>
							</div>
							{(promptErr || cwdErr) && (
								<div className="mt-1.5 space-y-0.5">
									{promptErr && (
										<p className="text-[11px] text-rose-400">{promptErr}</p>
									)}
									{cwdErr && (
										<p className="text-[11px] text-rose-400">{cwdErr}</p>
									)}
								</div>
							)}
						</section>

						{/* 高级选项 — ChatGPT-style muted label + chevron */}
						<section className="mt-6">
							<button
								type="button"
								onClick={() => setAdvancedOpen((v) => !v)}
								aria-expanded={advancedOpen}
								className="flex items-center gap-1 py-1 text-xs font-medium text-[var(--text-60,var(--text-muted))] transition-colors hover:text-[var(--text)]"
							>
								<span>{t("schedules.advancedOptions")}</span>
								<ChevronDown
									size={14}
									className={clsx(
										"text-[var(--text-30,var(--text-dim))] transition-transform",
										!advancedOpen && "-rotate-90",
									)}
								/>
							</button>

							{advancedOpen && (
								<div className="mt-3 divide-y divide-[var(--line)] rounded-3xl border border-[var(--line)] bg-[var(--bg-panel)] shadow-sm">
									{/* 收件箱通知 — which finished runs create an inbox entry */}
									<CardRow
										label={t("schedules.notifyLabel")}
										labelHint={t("schedules.notifyHint")}
									>
										<PillMenu
											id="notify"
											openMenu={openMenu}
											onToggle={toggleMenu}
											label={
												NOTIFY_OPTIONS.find(
													(o) => o.value === form.notify,
												)?.labelKey ? t(NOTIFY_OPTIONS.find((o) => o.value === form.notify)!.labelKey) : form.notify
											}
											menuClassName="w-60"
										>
											<MenuHeader>{t("schedules.notifyLabel")}</MenuHeader>
											{NOTIFY_OPTIONS.map((o) => (
												<MenuItem
													key={o.value}
													selected={form.notify === o.value}
													label={t(o.labelKey)}
													desc={t(o.descKey)}
													onClick={() => {
														setOpenMenu(null);
														set("notify", o.value);
													}}
												/>
											))}
										</PillMenu>
									</CardRow>

									{/* 运行位置 — local dir vs isolated git worktree */}
									<CardRow label={t("schedules.runLocationLabel")} desc={t("schedules.runLocationDesc")}>
										<PillMenu
											id="runMode"
											openMenu={openMenu}
											onToggle={toggleMenu}
											label={
												form.runMode === "worktree"
													? t("schedules.runModeWorktree")
													: t("schedules.runModeLocal")
											}
											menuClassName="w-64"
										>
											<MenuHeader>{t("schedules.runLocationLabel")}</MenuHeader>
											<MenuItem
												selected={form.runMode === "local"}
												label={t("schedules.runModeLocal")}
												desc={t("schedules.runModeLocalDesc")}
												onClick={() => {
													setOpenMenu(null);
													set("runMode", "local");
												}}
											/>
											<MenuItem
												selected={form.runMode === "worktree"}
												disabled={!isGitRepo}
												label={t("schedules.runModeWorktree")}
												desc={
													isGitRepo
														? t("schedules.runModeWorktreeDesc")
														: t("schedules.runModeWorktreeDisabled")
												}
												onClick={() => {
													setOpenMenu(null);
													setForm((f) => ({
														...f,
														runMode: "worktree",
														newChatEachRun: true,
													}));
												}}
											/>
										</PillMenu>
									</CardRow>

									{/* 每次运行新建会话 — off reuses the previous run's session (local only) */}
									<div className="px-4 py-3">
										<div className="flex items-center justify-between gap-3">
											<span className="text-xs text-[var(--text)]">
												{t("schedules.newSessionEachRun")}
											</span>
											<Switch
												checked={
													form.runMode === "worktree"
														? true
														: form.newChatEachRun
												}
												disabled={form.runMode === "worktree"}
												onChange={(v) => set("newChatEachRun", v)}
												title={
													form.runMode === "worktree"
														? t("schedules.newSessionWorktreeSwitchTitle")
														: undefined
												}
												ariaLabel={t("schedules.newSessionEachRun")}
											/>
										</div>
										<p className="mt-1 text-[11px] text-[var(--text-40,var(--text-dim))]">
											{form.runMode === "worktree"
												? t("schedules.newSessionWorktreeHint")
												: t("schedules.newSessionReuseHint")}
										</p>
									</div>

									{/* Unattended approval hint — only below 完全访问 */}
									{form.approvalMode !== "yolo" && (
										<div className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
											<Info size={12} className="shrink-0" />
											<span>
												{t("schedules.unattendedApprovalHint")}
											</span>
										</div>
									)}
								</div>
							)}
						</section>
					</div>
				</div>
			)}
		</div>
	);
}

/** Small muted label above each form field. */
function FieldLabel({ children }: { children: ReactNode }) {
	return (
		<div className="mb-1.5 text-xs font-medium text-[var(--text-60,var(--text-muted))]">
			{children}
		</div>
	);
}

/** Label column (left, optional muted desc + ⓘ hint) + right-aligned control. */
function CardRow({
	label,
	labelHint,
	desc,
	children,
}: {
	label: string;
	/** Native-tooltip text behind a small ⓘ icon next to the label. */
	labelHint?: string;
	/** One-line muted description under the label. */
	desc?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<div className="min-w-0 shrink-0">
				<span className="flex items-center gap-1 text-xs text-[var(--text)]">
					{label}
					{labelHint && (
						<span
							role="img"
							aria-label={labelHint}
							title={labelHint}
							className="text-[var(--text-30,var(--text-dim))] transition-colors hover:text-[var(--text-60,var(--text-muted))]"
						>
							<Info size={11} />
						</span>
					)}
				</span>
				{desc && (
					<p className="mt-0.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
						{desc}
					</p>
				)}
			</div>
			<div className="ml-auto flex min-w-0 items-center gap-2">{children}</div>
		</div>
	);
}

/** Pill tabs (设置 | 历史) — fully rounded local version of the segmented control. */
function PillTabs<T extends string>({
	options,
	value,
	onChange,
	"aria-label": ariaLabel,
}: {
	options: {
		value: T;
		label: ReactNode;
		title?: string;
		disabled?: boolean;
	}[];
	value: T;
	onChange: (value: T) => void;
	"aria-label"?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={ariaLabel}
			className="hairline inline-flex items-center gap-0.5 rounded-full bg-[var(--well-bg)] p-0.5"
		>
			{options.map((o) => {
				const active = value === o.value;
				return (
					<button
						key={o.value}
						type="button"
						role="radio"
						aria-checked={active}
						disabled={o.disabled}
						title={o.title}
						onClick={() => onChange(o.value)}
						className={clsx(
							"whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
							active
								? "bg-[var(--bg-panel)] text-[var(--text)] shadow-sm"
								: "text-[var(--text-60,var(--text-muted))] hover:text-[var(--text)]",
						)}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

/** Right-aligned value trigger: label + chevron, soft pill bg on hover/open. */
function PillButton({
	children,
	open,
	onClick,
	ref,
}: {
	children: ReactNode;
	open?: boolean;
	onClick: () => void;
	ref?: Ref<HTMLButtonElement>;
}) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			aria-expanded={open}
			className={clsx(
				"flex select-none items-center gap-1 rounded-full px-2.5 py-1 text-xs text-[var(--text)] transition-colors",
				open
					? "bg-[var(--ghost-hover,var(--bg-hover))]"
					: "hover:bg-[var(--ghost-hover,var(--bg-hover))]",
			)}
		>
			<span className="truncate">{children}</span>
			<ChevronDown
				size={12}
				className={clsx(
					"shrink-0 text-[var(--text-30,var(--text-dim))] transition-transform",
					open && "rotate-180",
				)}
			/>
		</button>
	);
}

/** Muted small header line at the top of a dropdown menu. */
function MenuHeader({ children }: { children: ReactNode }) {
	return (
		<div className="px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
			{children}
		</div>
	);
}

/** Hairline between menu item groups. */
function MenuDivider() {
	return <div className="mx-1 my-1 border-t border-[var(--line,var(--border-divider))]" />;
}

/** One menu row: label (+ optional muted desc), right ✓ when selected. */
function MenuItem({
	label,
	desc,
	selected,
	disabled,
	onClick,
	children,
}: {
	label?: ReactNode;
	desc?: ReactNode;
	selected?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children?: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={clsx(
				"flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors",
				disabled
					? "cursor-not-allowed text-[var(--text-30,var(--text-dim))] opacity-50"
					: selected
						// Selection is the ✓ only — the rounded fill belongs to hover.
						? "text-[var(--text)] hover:bg-[var(--ghost-hover,var(--bg-hover))]"
						: "text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
			)}
		>
			{children ?? (
				<span className="min-w-0 flex-1">
					<span className="block truncate">{label}</span>
					{desc != null && (
						<span className="block truncate text-[10px] text-[var(--text-40,var(--text-dim))]">
							{desc}
						</span>
					)}
				</span>
			)}
			{selected && (
				<Check
					size={13}
					className="ml-auto shrink-0 text-[var(--text-60,var(--text-muted))]"
				/>
			)}
		</button>
	);
}

/**
 * Value pill + anchored dropdown used by every card row on this page.
 * `children` are MenuItem/MenuHeader/MenuDivider content.
 */
function PillMenu({
	id,
	openMenu,
	onToggle,
	label,
	menuClassName,
	children,
}: {
	id: MenuId;
	openMenu: MenuId | null;
	onToggle: (id: MenuId) => void;
	/** Shown value; also feeds the trigger's aria-label. */
	label: string;
	menuClassName?: string;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const open = openMenu === id;
	return (
		<div ref={ref}>
			<PillButton open={open} onClick={() => onToggle(id)}>
				{label}
			</PillButton>
			{open && (
				<FloatingLayer
					anchor={ref.current}
					placement="bottom-end"
					offset={6}
					layer="popover"
					ignoreRefs={[ref]}
					onDismiss={() => onToggle(id)}
					className={clsx(MENU_CLASS, menuClassName)}
				>
					{children}
				</FloatingLayer>
			)}
		</div>
	);
}

/** Compact −/input/+ stepper for integer counts (N of `每 N unit`, 重复 N 次). */
function NumberStepper({
	value,
	min,
	onChange,
	ariaLabel,
}: {
	value: number;
	min: number;
	onChange: (value: number) => void;
	ariaLabel: string;
}) {
	const { t } = useT();
	const step = (delta: number) => onChange(Math.max(min, value + delta));
	const btn =
		"flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] active:scale-95";
	return (
		<div className="flex items-center gap-0.5 rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--bg)] p-0.5">
			<button
				type="button"
				onClick={() => step(-1)}
				disabled={value <= min}
				aria-label={t("schedules.stepperDecrease")}
				className={clsx(btn, "disabled:opacity-30")}
			>
				<Minus size={11} />
			</button>
			<input
				type="number"
				min={min}
				value={value}
				onChange={(e) => onChange(Math.floor(Number(e.target.value) || 0))}
				aria-label={ariaLabel}
				className="w-10 bg-transparent text-center text-xs text-[var(--text)] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<button
				type="button"
				onClick={() => step(1)}
				aria-label={t("schedules.stepperIncrease")}
				className={btn}
			>
				<Plus size={11} />
			</button>
		</div>
	);
}

function RunStatusIcon({ status }: { status: ScheduleRun["status"] }) {
	if (status === "running") {
		return (
			<Loader2 size={14} className="animate-spin text-sky-400 shrink-0" />
		);
	}
	if (status === "ok") {
		return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
	}
	if (status === "error") {
		return <XCircle size={14} className="text-rose-400 shrink-0" />;
	}
	return <AlertCircle size={14} className="text-amber-400 shrink-0" />;
}
