import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertCircle,
	AlertTriangle,
	ArrowUpDown,
	Check,
	ChevronDown,
	ChevronRight,
	FolderOpen,
	Info,
	MessageSquarePlus,
	Play,
	Power,
	Puzzle,
	RefreshCw,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingLayer, Z_LAYER } from "../../components/FloatingLayer";
import { CopyButton } from "../../components/CopyButton";
import { EmptyState } from "../../components/EmptyState";
import { Notice } from "../../components/Notice";
import { SearchInput } from "../../components/SearchInput";
import { Segmented } from "../../components/Segmented";
import type { ExtensionItem, SkillIssue, SkillItem } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { absoluteTime } from "../../lib/format";
import { useEscapeKey } from "../../lib/hooks";
import { skillsRead } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT, tNow } from "../../stores/language";
import { Markdown } from "../../components/Markdown";
import { formatRelativeTime } from "../schedules/humanCadence";
import { Switch } from "../settings/Switch";
import { resolveSkillEnablement, type SkillDisabledReason } from "../../lib/skillEnablement";
import {
	USAGE_DAYS,
	computeSkillStats,
	selectVisibleSkills,
	useSkillsStore,
	type SkillSort,
	type SkillsDrawerTarget,
} from "./store";

/** Drop a leading YAML frontmatter block; name/description are shown in the header. */
function stripFrontmatter(text: string): string {
	const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	return m ? text.slice(m[0].length).trimStart() : text;
}

const ISSUE_META_KEYS: Record<SkillIssue, { labelKey: string; explainKey: string }> = {
	missing_description: {
		labelKey: "skills.issueMissingDescriptionLabel",
		explainKey: "skills.issueMissingDescriptionExplain",
	},
	description_too_long: {
		labelKey: "skills.issueDescriptionTooLongLabel",
		explainKey: "skills.issueDescriptionTooLongExplain",
	},
	unreadable: {
		labelKey: "skills.issueUnreadableLabel",
		explainKey: "skills.issueUnreadableExplain",
	},
	missing_skill_md: {
		labelKey: "skills.issueMissingSkillMdLabel",
		explainKey: "skills.issueMissingSkillMdExplain",
	},
};

const ISSUE_ORDER: SkillIssue[] = [
	"missing_skill_md",
	"unreadable",
	"description_too_long",
	"missing_description",
];

const sourceLabel = (source: string) =>
	source === "project" ? tNow("skills.sourceProject") : tNow("skills.sourceGlobal");

const SORT_OPTIONS: { value: SkillSort; labelKey: string }[] = [
	{ value: "count", labelKey: "skills.sortCount" },
	{ value: "lastUsed", labelKey: "skills.sortLastUsed" },
	{ value: "name", labelKey: "skills.sortName" },
];

/** Short badge + explanatory text for why a skill is off for new sessions. */
function describeDisabledReason(reason: SkillDisabledReason): {
	badge: string;
	detail: string;
} {
	switch (reason.kind) {
		case "disabled":
			return { badge: tNow("skills.reasonDisabledBadge"), detail: tNow("skills.reasonDisabledDetail") };
		case "source":
			return {
				badge: tNow("skills.reasonSourceBadge"),
				detail: tNow("skills.reasonSourceDetail", { key: reason.key }),
			};
		case "ignored":
			return reason.exact
				? {
						badge: tNow("skills.reasonIgnoredExactBadge"),
						detail: tNow("skills.reasonIgnoredExactDetail"),
					}
				: {
						badge: tNow("skills.reasonIgnoredPatternBadge"),
						detail: tNow("skills.reasonIgnoredPatternDetail", { pattern: reason.pattern }),
					};
		case "not_included":
			return {
				badge: tNow("skills.reasonNotIncludedBadge"),
				detail: tNow("skills.reasonNotIncludedDetail"),
			};
		case "all_off":
			return {
				badge: tNow("skills.reasonAllOffBadge"),
				detail: tNow("skills.reasonAllOffDetail"),
			};
	}
}

const GLOBAL_SCOPE_CHIP = () => tNow("skills.globalScopeChip");
const PROJECT_OVERRIDE_TITLE = () =>
	tNow("skills.projectOverrideTitle");

/** A locked Switch can't take a title — wrap it so tooltips still work. */
function SkillSwitch({
	skill,
	enabled,
	reason,
	pending,
	overridden,
	onToggle,
}: {
	skill: SkillItem;
	enabled: boolean;
	reason: SkillDisabledReason | null;
	pending: boolean;
	overridden: boolean;
	onToggle: (skill: SkillItem, next: boolean) => void;
}) {
	const locked =
		overridden ||
		(reason !== null &&
			reason.kind !== "disabled" &&
			!(reason.kind === "ignored" && reason.exact));
	return (
		<span
			className="inline-flex"
			title={
				pending
					? tNow("skills.switchUpdating")
					: overridden
						? PROJECT_OVERRIDE_TITLE()
						: reason
							? describeDisabledReason(reason).detail
							: enabled
								? tNow("skills.switchDisableGlobalHint")
								: undefined
			}
		>
			<Switch
				checked={enabled}
				disabled={pending || locked}
				onChange={(next) => onToggle(skill, next)}
			/>
		</span>
	);
}


/** Shared delete-confirm body: popover (row) and inline panel (drawer). */
function DeleteConfirmBody({
	skill,
	busy,
	onCancel,
	onConfirm,
}: {
	skill: SkillItem;
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const { t } = useT();
	return (
		<div className="w-64">
			<p className="text-xs leading-relaxed text-neutral-200">
				{t("skills.deleteDialogTitle", { name: skill.name })}
			</p>
			<p
				className="mt-1.5 truncate font-mono text-[11px] text-neutral-500"
				title={skill.dir}
			>
				{skill.dir}
			</p>
			{skill.copies > 1 && (
				<p className="mt-1.5 text-[11px] leading-relaxed text-amber-400/90">
					{t("skills.deleteCopiesWarning", { count: skill.copies - 1 })}
				</p>
			)}
			<div className="mt-3 flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 disabled:opacity-50"
				>
					{t("common.cancel")}
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
				>
					<Trash2 size={12} />
					{t("skills.moveToTrash")}
				</button>
			</div>
		</div>
	);
}
/**
 * Insert a skill invocation into the selected session's composer draft.
 * Enabled skills use `/skill:<name>`. OMP does not register that command for
 * disabled skills, so for those we insert an instruction to read SKILL.md by
 * absolute path instead (the `read` tool accepts any file).
 */
function insertSkillIntoComposer(skill: SkillItem, enabled: boolean): boolean {
	const selectedSessionId = useUi.getState().selectedSessionId;
	if (!selectedSessionId) {
		toast.error(tNow("skills.noSessionSelected"));
		return false;
	}
	const existingDraft = useComposer.getState().drafts[selectedSessionId] ?? "";
	const invocation = enabled
		? `/skill:${skill.name} `
		: `请先读取 Skill 文件 \`${skill.path}\`，并按其中的说明完成下面的任务（该 Skill 在 OMP 中已停用，本次临时使用；文中的相对路径以 \`${skill.dir}\` 为基准）：\n`;
	useComposer
		.getState()
		.setDraft(
			selectedSessionId,
			existingDraft ? `${invocation}${existingDraft}` : invocation,
		);
	useComposer.getState().focusComposer(selectedSessionId);
	useUi.getState().setCenter("session");
	toast.success(
		enabled
			? tNow("skills.insertedSkill", { name: skill.name })
			: tNow("skills.insertedDisabledSkill", { name: skill.name }),
	);
	return true;
}

/** Skills without a SKILL.md are ignored by OMP, so there is nothing to invoke. */
const skillUsable = (skill: SkillItem) =>
	!skill.issues.includes("missing_skill_md");

const ROW_ACTION =
	"flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-divider)] bg-neutral-800/60 text-neutral-300 transition-colors disabled:cursor-not-allowed disabled:opacity-30";

const DISABLED_FILE_HINT = () => tNow("skills.disabledFileHint");

const skillUseTitle = (skill: SkillItem, enabled: boolean, hasSession: boolean) =>
	!skillUsable(skill)
		? tNow("skills.skillUseMissingSkillMd")
		: !hasSession
			? tNow("skills.skillUseNoSession")
			: enabled
				? tNow("skills.skillUseEnabled", { name: skill.name })
				: tNow("skills.skillUseDisabled");

/** Info circle next to the 启用 column header explaining what the switch does. */
function EnableInfoButton() {
	const { t } = useT();
	const btnRef = useRef<HTMLButtonElement>(null);
	const [hover, setHover] = useState(false);
	const [pinned, setPinned] = useState(false);
	const closeTimer = useRef<number | null>(null);
	const enter = () => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		closeTimer.current = null;
		setHover(true);
	};
	const leave = () => {
		closeTimer.current = window.setTimeout(() => setHover(false), 150);
	};
	useEffect(
		() => () => {
			if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		},
		[],
	);
	const open = hover || pinned;
	return (
		<>
			<button
				ref={btnRef}
				type="button"
				aria-label={t("skills.enableInfoAriaLabel")}
				onMouseEnter={enter}
				onMouseLeave={leave}
				onClick={() => setPinned((p) => !p)}
				className={clsx(
					"flex h-4 w-4 items-center justify-center rounded-full normal-case transition-colors hover:text-neutral-300",
					open ? "text-neutral-300" : "text-neutral-600",
				)}
			>
				<Info size={11} />
			</button>
			<FloatingLayer
				anchor={open ? btnRef.current : null}
				placement="left-start"
				offset={8}
				layer="hovercard"
				onDismiss={pinned ? () => setPinned(false) : undefined}
				ignoreRefs={[btnRef]}
				onMouseEnter={enter}
				onMouseLeave={leave}
				role="dialog"
				aria-label={t("skills.enableInfoAriaLabel")}
				className="w-[260px] rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-left text-[12px] font-normal normal-case leading-relaxed tracking-normal text-neutral-300 shadow-2xl"
			>
				<div className="mb-1.5 font-semibold text-neutral-100">{t("skills.enableInfoTitle")}</div>
				<ul className="list-disc space-y-1 pl-4 text-neutral-400">
					<li>{t("skills.enableInfoItem1")}</li>
					<li>{t("skills.enableInfoItem2")}</li>
					<li>{t("skills.enableInfoItem3")}</li>
					<li>{t("skills.enableInfoItem4")}</li>
				</ul>
			</FloatingLayer>
		</>
	);
}

async function revealInFinder(path: string) {
	try {
		await revealItemInDir(path);
	} catch (err) {
		toast.error(tNow("skills.revealInFinderFailed", { error: errMsg(err) }));
	}
}

function IssueBadges({ issues }: { issues: SkillIssue[] }) {
	const { t } = useT();
	return (
		<>
			{ISSUE_ORDER.filter((i) => issues.includes(i)).map((issue) => (
				<span
					key={issue}
					title={t(ISSUE_META_KEYS[issue].explainKey)}
					className={clsx(
						"shrink-0 rounded border px-1 py-px text-[10px] font-medium",
						issue === "unreadable"
							? "border-red-500/25 bg-red-500/10 text-red-400"
							: "border-amber-500/25 bg-amber-500/10 text-amber-400",
					)}
				>
					{t(ISSUE_META_KEYS[issue].labelKey)}
				</span>
			))}
		</>
	);
}

/** Right-side detail drawer overlaying the whole window (Z_LAYER.drawer). */
function DetailDrawer({
	target,
	onClose,
	onToggleExtension,
	togglingPath,
	onToggleSkill,
	togglingSkill,
	onTrashSkill,
	trashingDirs,
}: {
	target: SkillsDrawerTarget;
	onClose: () => void;
	onToggleExtension: (ext: ExtensionItem) => void;
	togglingPath: string | null;
	onToggleSkill: (skill: SkillItem, next: boolean) => void;
	togglingSkill: string | null;
	onTrashSkill: (skill: SkillItem) => void;
	trashingDirs: string[];
}) {
	const { t } = useT();
	const catalog = useSkillsStore((s) => s.catalog);
	const skillConfig = useSkillsStore((s) => s.skillConfig);
	const listOverridden = useSkillsStore((s) => s.skillConfigOverrides.includes("disabledExtensions"));
	const usageError = useSkillsStore((s) => s.usageError);
	const usageReport = useSkillsStore((s) => s.usageReport);
	const usage = useSkillsStore((s) => s.usage);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const [confirmDelete, setConfirmDelete] = useState(false);

	const skill =
		target.kind === "skill"
			? (catalog?.skills.find((s) => s.path === target.path) ?? null)
			: null;
	const extension =
		target.kind === "extension"
			? (catalog?.extensions.find((e) => e.path === target.path) ?? null)
			: null;

	const itemUsage = skill ? usage[skill.name] : undefined;
	const days = usageReport?.days ?? USAGE_DAYS;

	// Rendered SKILL.md body (frontmatter stripped — the meta is shown above).
	const [doc, setDoc] = useState<{
		text: string | null;
		loading: boolean;
		error: string | null;
	}>({ text: null, loading: false, error: null });

	useEffect(() => {
		if (target.kind !== "skill") return;
		let cancelled = false;
		setDoc({ text: null, loading: true, error: null });
		skillsRead(target.path)
			.then((text) => {
				if (!cancelled)
					setDoc({ text: stripFrontmatter(text), loading: false, error: null });
			})
			.catch((err) => {
				if (!cancelled)
					setDoc({ text: null, loading: false, error: errMsg(err) });
			});
		return () => {
			cancelled = true;
		};
	}, [target]);

	// Slide-in on mount.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() =>
			requestAnimationFrame(() => setMounted(true)),
		);
		return () => cancelAnimationFrame(id);
	}, []);

	useEscapeKey(onClose);

	if (!skill && !extension) return null;

	const dirName =
		skill?.dir.split(/[\\/]/).filter(Boolean).pop() ?? skill?.name ?? "";
	const issues = skill?.issues ?? [];
	const enablement = skill ? resolveSkillEnablement(skill, skillConfig) : null;
	const skillLocked =
		enablement?.reason !== null &&
		enablement?.reason !== undefined &&
		enablement.reason.kind !== "disabled" &&
		!(enablement.reason.kind === "ignored" && enablement.reason.exact);

	return createPortal(
		<div className="fixed inset-0" style={{ zIndex: Z_LAYER.drawer }}>
			{/* Backdrop */}
			<div
				onMouseDown={onClose}
				className={clsx(
					"absolute inset-0 bg-[var(--overlay)] transition-opacity duration-200",
					mounted ? "opacity-100" : "opacity-0",
				)}
			/>
			{/* Panel */}
			<aside
				className={clsx(
					"absolute bottom-0 right-0 top-0 flex min-w-0 flex-col border-l border-[var(--border-divider)] bg-[var(--bg-panel)] shadow-apple-modal transition-transform duration-200 ease-out",
					mounted ? "translate-x-0" : "translate-x-full",
				)}
				style={{ width: "min(560px, 92vw)" }}
			>
				{/* Header */}
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] px-5 py-4">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h2 className="truncate text-base font-semibold text-neutral-100">
								{skill?.name ?? extension?.name}
							</h2>
							<span
								className={clsx(
									"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
									(skill ?? extension)?.source === "project"
										? "border border-amber-500/20 bg-amber-500/10 text-amber-400"
										: "bg-neutral-800 text-neutral-400",
								)}
							>
								{sourceLabel((skill ?? extension)?.source ?? "")}
							</span>
							{extension && (
								<span
									className={clsx(
										"flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
										extension.enabled
											? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
											: "border-neutral-700 bg-neutral-800 text-neutral-400",
									)}
								>
									<Power size={10} />
									{extension.enabled ? t("skills.extensionStatusEnabled") : t("skills.extensionStatusDisabled")}
								</span>
							)}
						</div>
						{skill && (
							<span
								className={clsx(
									"mt-1 inline-block rounded border px-1.5 py-px font-mono text-[11px]",
									enablement?.enabled === false
										? "border-neutral-700 bg-neutral-800/60 text-neutral-500 line-through"
										: "border-sky-500/20 bg-sky-500/10 text-sky-400",
								)}
								title={
									enablement?.enabled === false
										? t("skills.extensionDisabledHint")
										: undefined
								}
							>
								/skill:{skill.name}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						title={t("skills.closeEsc")}
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						<X size={14} />
					</button>
				</div>

				{/* Scrollable body */}
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{/* Copyable paths */}
					{[
						{ label: t("skills.installLocation"), value: skill ? skill.root : null },
						{
							label: skill ? t("skills.skillMdPath") : t("skills.filePath"),
							value: (skill ?? extension)?.path ?? null,
						},
					]
						.filter((r): r is { label: string; value: string } => !!r.value)
						.map((r) => (
							<div key={r.label} className="mb-2 flex items-center gap-2 text-xs">
								<span className="w-24 shrink-0 whitespace-nowrap text-neutral-500">{r.label}</span>
								<span
									className="min-w-0 flex-1 truncate font-mono text-neutral-300"
									title={r.value}
								>
									{r.value}
								</span>
								<CopyButton
									text={r.value}
									title={t("skills.copyField", { label: r.label })}
									className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
								/>
							</div>
						))}

					{/* Meta grid */}
					{skill ? (
						<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl hairline bg-[var(--well-bg)]/40 p-3.5 text-xs">
							<div>
								<dt className="text-neutral-500">{t("skills.dirName")}</dt>
								<dd className="mt-0.5 font-mono text-neutral-200">{dirName}</dd>
							</div>
							<div>
								<dt className="text-neutral-500">{t("skills.sourceLabel")}</dt>
								<dd className="mt-0.5 text-neutral-200">
									{sourceLabel(skill.source)}
								</dd>
							</div>
							<div>
								<dt className="text-neutral-500">{t("skills.triggerStats")}</dt>
								<dd className="mt-0.5 text-neutral-200">
									{usageError ? (
										<span title={usageError}>{t("skills.statsUnavailable")}</span>
									) : (itemUsage?.count ?? 0) > 0 ? (
										<>
											{t("skills.statsDaysCount", { days, count: itemUsage?.count ?? 0 })}
											{itemUsage?.lastUsedAt && (
												<span className="text-neutral-500">
													{" "}
													{t("skills.statsLastUsed", { time: formatRelativeTime(itemUsage.lastUsedAt) })}
												</span>
											)}
										</>
									) : itemUsage?.lastUsedAt ? (
										<span className="text-neutral-400">
											{t("skills.statsLastUsedOnly", { time: formatRelativeTime(itemUsage.lastUsedAt) })}
										</span>
									) : (
										<span className="text-neutral-500">{t("skills.statsNeverTriggered")}</span>
									)}
								</dd>
							</div>
							<div>
								<dt className="text-neutral-500">{t("skills.copiesCount")}</dt>
								<dd className="mt-0.5 text-neutral-200">
									{skill.copies > 1
										? t("skills.copiesPriority", { count: skill.copies })
										: "1"}
								</dd>
							</div>
							<div className="col-span-2">
								<dt className="text-neutral-500">{t("skills.issues")}</dt>
								<dd className="mt-0.5">
									{issues.length === 0 ? (
										<span className="text-emerald-400/90">{t("skills.noIssues")}</span>
									) : (
										<span className="flex flex-wrap gap-1">
											<IssueBadges issues={issues} />
										</span>
									)}
								</dd>
							</div>
						</dl>
					) : (
						extension && (
							<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl hairline bg-[var(--well-bg)]/40 p-3.5 text-xs">
								<div>
									<dt className="text-neutral-500">{t("skills.extensionId")}</dt>
									<dd className="mt-0.5 font-mono text-neutral-200">
										{extension.name}
									</dd>
								</div>
								<div>
									<dt className="text-neutral-500">{t("skills.sourceLabel")}</dt>
									<dd className="mt-0.5 text-neutral-200">
										{sourceLabel(extension.source)}
									</dd>
								</div>
								<div className="col-span-2">
									<dt className="text-neutral-500">{t("skills.status")}</dt>
									<dd className="mt-0.5 text-neutral-200">
										{extension.enabled
											? t("skills.extensionEnabledStatus")
											: t("skills.extensionDisabledStatus")}
									</dd>
								</div>
							</dl>
						)
					)}

					{/* Issue explanations */}
					{issues.length > 0 && (
						<div className="mt-3 space-y-1.5 rounded-xl border border-amber-500/15 bg-amber-500/5 p-3.5">
							{ISSUE_ORDER.filter((i) => issues.includes(i)).map((issue) => (
								<p key={issue} className="text-[11px] leading-relaxed text-amber-200/80">
									<span className="font-medium text-amber-300">
										{t("skills.issueLabelPrefix", { label: t(ISSUE_META_KEYS[issue].labelKey) })}
									</span>
									{t(ISSUE_META_KEYS[issue].explainKey)}
								</p>
							))}
						</div>
					)}

					{/* Actions */}
					<div className="mt-4 flex items-center gap-2">
						{skill && (
							<button
								type="button"
								onClick={() => {
									if (insertSkillIntoComposer(skill, enablement?.enabled ?? true)) onClose();
								}}
								disabled={!selectedSessionId || !skillUsable(skill)}
								title={skillUseTitle(skill, enablement?.enabled ?? true, !!selectedSessionId)}
								className={clsx(
									"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95",
									selectedSessionId
										? "bg-amber-600/90 text-white hover:bg-amber-500"
										: "cursor-not-allowed bg-neutral-800 text-neutral-500 opacity-50",
								)}
							>
								<MessageSquarePlus size={13} />
								<span>{t("skills.useInSession")}</span>
							</button>
						)}
						{skill && enablement && (
							<span
								className="inline-flex"
								title={
									listOverridden
										? PROJECT_OVERRIDE_TITLE()
										: skillLocked && enablement.reason
											? describeDisabledReason(enablement.reason).detail
											: t("skills.globalScopeToggleHint")
								}
							>
								<button
									type="button"
									disabled={skillLocked || listOverridden || togglingSkill === skill.path}
									onClick={() => onToggleSkill(skill, !enablement.enabled)}
									className={clsx(
										"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95 disabled:opacity-50",
										enablement.enabled
											? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
											: "bg-emerald-600 text-white hover:bg-emerald-500",
									)}
								>
									<Power size={13} />
									<span>{enablement.enabled ? t("skills.disable") : t("skills.enable")}</span>
								</button>
							</span>
						)}
						{skill && (
							<span className="text-[11px] text-neutral-500">{GLOBAL_SCOPE_CHIP()}</span>
						)}
						{extension && (
							<>
								<button
									type="button"
									disabled={togglingPath === extension.path || listOverridden}
									title={listOverridden ? PROJECT_OVERRIDE_TITLE() : undefined}
									onClick={() => onToggleExtension(extension)}
									className={clsx(
										"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95 disabled:opacity-50",
										extension.enabled
											? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
											: "bg-emerald-600 text-white hover:bg-emerald-500",
									)}
								>
									<Power size={13} />
									<span>{extension.enabled ? t("skills.disableExtension") : t("skills.enableExtension")}</span>
								</button>
								<span className="text-[11px] text-neutral-500">{GLOBAL_SCOPE_CHIP()}</span>
								{!extension.enabled && extension.path.endsWith(".disabled") && (
									<span className="text-[11px] text-neutral-500">{DISABLED_FILE_HINT()}</span>
								)}
							</>
						)}
						<button
							type="button"
							onClick={() =>
								revealInFinder(
									skill ? skill.dir || skill.path : (extension?.path ?? ""),
								)
							}
							className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs font-medium text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
						>
							<FolderOpen size={13} />
							<span>{t("skills.revealInFinder")}</span>
						</button>
						{skill && (
							<button
								type="button"
								disabled={trashingDirs.includes(skill.dir)}
								onClick={() => setConfirmDelete(true)}
								title={t("skills.trashSkillTitle")}
								className="flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
							>
								<Trash2 size={13} />
								<span>{t("common.delete")}</span>
							</button>
						)}
					</div>
					{/* Inline delete confirmation */}
					{skill && confirmDelete && (
						<div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/5 p-3.5">
							<DeleteConfirmBody
								skill={skill}
								busy={trashingDirs.includes(skill.dir)}
								onCancel={() => setConfirmDelete(false)}
								onConfirm={() => onTrashSkill(skill)}
							/>
						</div>
					)}

					{/* Rendered SKILL.md */}
					{skill && (
						<div className="mt-4 border-t border-[var(--border-divider)] pt-4">
							{doc.loading ? (
								<div className="space-y-3">
									<div className="h-5 w-1/3 animate-pulse rounded bg-neutral-800/60" />
									<div className="h-3.5 w-full animate-pulse rounded bg-neutral-800/40" />
									<div className="h-3.5 w-5/6 animate-pulse rounded bg-neutral-800/40" />
									<div className="h-3.5 w-2/3 animate-pulse rounded bg-neutral-800/40" />
								</div>
							) : doc.error ? (
								<div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
									<div className="flex items-center gap-2 font-medium">
										<AlertCircle size={14} />
										<span>{t("skills.readSkillDocFailed")}</span>
									</div>
									<p className="mt-1 text-neutral-400">{doc.error}</p>
								</div>
							) : doc.text ? (
								<Markdown text={doc.text} />
							) : (
								<div className="flex h-24 items-center justify-center text-xs text-neutral-500">
									{t("skills.emptyDocContent")}
								</div>
							)}
						</div>
					)}

					{extension && (
						<div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 text-xs leading-relaxed text-neutral-400">
							<p className="mb-1 font-medium text-sky-300">{t("skills.aboutOmpExtensionsTitle")}</p>
							<p>
								{t("skills.aboutOmpExtensionsP1")}
								<code className="rounded bg-sky-950/60 px-1 py-0.5 font-mono text-sky-200">
									disabledExtensions
								</code>
								{t("skills.aboutOmpExtensionsP2")}
							</p>
						</div>
					)}
				</div>
			</aside>
		</div>,
		document.body,
	);
}

const SKILL_COLS =
	"grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(88px,0.5fr)_minmax(96px,0.6fr)_52px_132px]";
const EXT_COLS =
	"grid-cols-[minmax(0,1.8fr)_minmax(80px,0.4fr)_minmax(0,2fr)_minmax(110px,0.6fr)]";

export function SkillsPage() {
	const { t } = useT();
	const catalog = useSkillsStore((s) => s.catalog);
	const loading = useSkillsStore((s) => s.loading);
	const error = useSkillsStore((s) => s.error);
	const activeTab = useSkillsStore((s) => s.activeTab);
	const searchQuery = useSkillsStore((s) => s.searchQuery);
	const sourceFilter = useSkillsStore((s) => s.sourceFilter);
	const skillConfig = useSkillsStore((s) => s.skillConfig);
	const listOverridden = useSkillsStore((s) => s.skillConfigOverrides.includes("disabledExtensions"));
	const projectConfigPath = useSkillsStore((s) => s.projectConfigPath);
	const projectConfigNotice = useSkillsStore((s) => s.projectConfigNotice);
	const trashingDirs = useSkillsStore((s) => s.trashingDirs);
	const setSkillEnabled = useSkillsStore((s) => s.setSkillEnabled);
	const trashSkill = useSkillsStore((s) => s.trashSkill);
	const statusFilter = useSkillsStore((s) => s.statusFilter);
	const sort = useSkillsStore((s) => s.sort);
	const drawer = useSkillsStore((s) => s.drawer);
	const usage = useSkillsStore((s) => s.usage);
	const usageReport = useSkillsStore((s) => s.usageReport);
	const usageLoading = useSkillsStore((s) => s.usageLoading);
	const usageError = useSkillsStore((s) => s.usageError);
	const usageLoaded = useSkillsStore((s) => s.usageLoaded);

	const loadCatalog = useSkillsStore((s) => s.loadCatalog);
	const loadUsage = useSkillsStore((s) => s.loadUsage);
	const refresh = useSkillsStore((s) => s.refresh);
	const setActiveTab = useSkillsStore((s) => s.setActiveTab);
	const setSearchQuery = useSkillsStore((s) => s.setSearchQuery);
	const setSourceFilter = useSkillsStore((s) => s.setSourceFilter);
	const setStatusFilter = useSkillsStore((s) => s.setStatusFilter);
	const setSort = useSkillsStore((s) => s.setSort);
	const openDrawer = useSkillsStore((s) => s.openDrawer);
	const closeDrawer = useSkillsStore((s) => s.closeDrawer);
	const setExtensionEnabled = useSkillsStore((s) => s.setExtensionEnabled);
	const revalidateCatalog = useSkillsStore((s) => s.revalidateCatalog);

	// Project scope follows the selected (or last viewed) session's cwd.
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const scopeSessionId = useUi((s) => s.selectedSessionId ?? s.lastSessionId);
	const projectCwd = useSessions((s) =>
		scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null,
	);

	useEffect(() => {
		loadCatalog(projectCwd);
	}, [projectCwd, loadCatalog]);
	useEffect(() => {
		loadUsage();
	}, [loadUsage]);
	// Pick up external edits (files added/removed outside the app) on mount and window focus.
	useEffect(() => {
		if (useSkillsStore.getState().catalog) void revalidateCatalog(projectCwd);
		const onFocus = () => void revalidateCatalog(projectCwd);
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [projectCwd, revalidateCatalog]);

	const stats = useMemo(
		() => computeSkillStats(catalog?.skills ?? [], usage, skillConfig),
		[catalog?.skills, usage, skillConfig],
	);

	const visibleSkills = useMemo(
		() =>
			selectVisibleSkills({
				catalog,
				searchQuery,
				sourceFilter,
				statusFilter,
				sort,
				usage,
				skillConfig,
			}),
		[catalog, searchQuery, sourceFilter, statusFilter, sort, usage, skillConfig],
	);

	const filteredExtensions = useMemo(() => {
		const exts = catalog?.extensions ?? [];
		const q = searchQuery.trim().toLowerCase();
		if (!q) return exts;
		return exts.filter(
			(e) =>
				e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q),
		);
	}, [catalog?.extensions, searchQuery]);

	const [sortOpen, setSortOpen] = useState(false);
	const sortBtnRef = useRef<HTMLButtonElement>(null);

	// Extension toggle in-flight tracker
	const [togglingPath, setTogglingPath] = useState<string | null>(null);

	const handleToggleExtension = async (ext: ExtensionItem) => {
		if (togglingPath) return;
		setTogglingPath(ext.path);
		try {
			await setExtensionEnabled(ext, !ext.enabled, projectCwd);
		} finally {
			setTogglingPath(null);
		}
	};

	const [deleteBusy, setDeleteBusy] = useState(false);
	const handleConfirmDelete = async (skill: SkillItem) => {
		if (deleteBusy) return;
		setDeleteBusy(true);
		try {
			await trashSkill(skill, projectCwd);
		} finally {
			setDeleteBusy(false);
			setDeleteAnchor(null);
		}
	};

	// Skill toggle in-flight tracker + per-row delete popover anchor
	const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
	const [deleteAnchor, setDeleteAnchor] = useState<{
		skill: SkillItem;
		el: HTMLElement;
	} | null>(null);

	const handleToggleSkill = async (skill: SkillItem, next: boolean) => {
		if (togglingSkill) return;
		setTogglingSkill(skill.path);
		try {
			await setSkillEnabled(skill, next);
		} finally {
			setTogglingSkill(null);
		}
	};

	const usagePending = usageLoading && !usageLoaded && !usageError;
	// Count/lastUsed ordering depends on usage; hold the list back until it is known so rows never jump.
	const sortPending = sort !== "name" && !usageLoaded && !usageError;
	const usageUnavailable = !!usageError && !usageReport;
	const days = usageReport?.days ?? USAGE_DAYS;

	const statCards: {
		key: "all" | "active" | "idle" | "issues";
		label: string;
		value: string | number;
		sub: string;
		alert?: boolean;
	}[] = [
		{
			key: "all",
			label: t("skills.statCardAll"),
			value: stats.total,
			sub: t("skills.statCardAllSub", { user: stats.userCount, project: stats.projectCount }),
		},
		{
			key: "active",
			label: t("skills.statCardActive"),
			value: usageUnavailable ? "—" : usagePending ? "…" : stats.active,
			sub: usageUnavailable ? t("skills.statsUnavailable") : t("skills.statCardActiveSub", { count: stats.totalTriggers }),
		},
		{
			key: "idle",
			label: t("skills.statCardIdle"),
			value: usageUnavailable ? "—" : usagePending ? "…" : stats.idle,
			sub: t("skills.statCardIdleSub", { days }),
		},
		{
			key: "issues",
			label: t("skills.statCardIssues"),
			value: stats.withIssues,
			sub: t("skills.statCardIssuesSub"),
			alert: stats.withIssues > 0,
		},
	];

	const skillSearchEmpty = searchQuery.trim().length > 0;
	const hasSkillFilters =
		skillSearchEmpty || sourceFilter !== "all" || statusFilter !== "all";

	return (
		<div className="h-full w-full select-none overflow-y-auto bg-[var(--bg)] text-[var(--text)]">
			<div className="mx-auto max-w-[1200px] px-6 pb-10 pt-5">
				{/* Header row: segmented tabs + search + refresh */}
				<div className="flex flex-wrap items-center gap-3">
					<Segmented
						value={activeTab}
						onChange={setActiveTab}
						options={[
							{ value: "skills", label: t("skills.tabMySkills", { count: stats.total }) },
							{
								value: "extensions",
								label: t("skills.tabExtensions", { count: catalog?.extensions.length ?? 0 }),
							},
						]}
					/>
					<div className="flex-1" />
					<SearchInput
						value={searchQuery}
						onChange={setSearchQuery}
						placeholder={activeTab === "skills" ? t("skills.searchPlaceholderSkill") : t("skills.searchPlaceholderExtension")}
						iconSize={13}
						className="w-56 sm:w-64"
						inputClassName="h-8 w-full rounded-lg hairline bg-[var(--well-bg)] pl-8 pr-7 text-xs text-neutral-100 placeholder-neutral-500 transition-all focus:outline-none focus:ring-1 focus:ring-amber-500/50"
					/>
					<button
						type="button"
						onClick={() => refresh(projectCwd)}
						disabled={loading}
						title={t("skills.refreshSkillsTitle")}
						className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 disabled:opacity-50"
					>
						<RefreshCw
							size={14}
							className={clsx(
								(loading || usageLoading) && "animate-spin text-sky-400",
							)}
						/>
					</button>
				</div>

				{/* Project scope indicator */}
				{activeTab === "skills" && (
					<div className="mt-3 flex flex-wrap items-start gap-2 text-[11px]">
						{projectCwd ? (
							<>
								<span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400">
									{t("skills.currentProjectLabel", { name: projectCwd.split("/").filter(Boolean).pop() ?? projectCwd })}
								</span>
								<span className="min-w-0 select-text break-all font-mono text-neutral-500">
									{projectCwd}
								</span>
							</>
						) : (
							<span className="text-neutral-500">
								{t("skills.projectSkillsNeedSession")}
							</span>
						)}
					</div>
				)}

				{/* Switches write the global config; show scope + project overrides */}
				<div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
					<span className="shrink-0 rounded-md border border-[var(--border-divider)] bg-neutral-800/60 px-2 py-0.5 font-medium text-neutral-300">
						{GLOBAL_SCOPE_CHIP()}
					</span>
					<span>{t("skills.globalConfigNotice")}</span>
				</div>
				{listOverridden && (
					<div
						role="alert"
						className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300"
					>
						<AlertCircle size={14} className="mt-0.5 shrink-0" />
						<span className="min-w-0 whitespace-pre-wrap break-words">
							{PROJECT_OVERRIDE_TITLE()}
							{projectConfigPath && (
								<>
									{t("skills.configFilePrefix")}
									<span className="select-text break-all font-mono">{projectConfigPath}</span>
								</>
							)}
						</span>
					</div>
				)}
				{projectConfigNotice && (
					<div
						role="status"
						className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300"
					>
						<AlertCircle size={14} className="mt-0.5 shrink-0" />
						<span className="min-w-0 select-text whitespace-pre-wrap break-words">
							{projectConfigNotice}
						</span>
					</div>
				)}

				{/* Error banner */}
				{error && (
					<div className="mt-4">
						<Notice
							tone="danger"
							action={
								<button
									type="button"
									onClick={() => refresh(projectCwd)}
									className="shrink-0 rounded-md border border-[var(--hairline-strong)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]"
								>
									{t("common.retry")}
								</button>
							}
						>
							<span className="select-text whitespace-pre-wrap break-words">{t("skills.loadFailed", { error })}</span>
						</Notice>
					</div>
				)}

				{activeTab === "skills" && (
					<>
						{/* Stat cards + budget */}
						<div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
							{statCards.map((card) => (
								<button
									key={card.key}
									type="button"
									onClick={() => setStatusFilter(card.key)}
									className={clsx(
										"rounded-xl hairline px-4 py-3 text-left transition-colors",
										statusFilter === card.key
											? "bg-[var(--bg-active-fill)] shadow-apple-card"
											: "bg-[var(--bg-panel)]/50 hover:bg-[var(--bg-hover)]",
									)}
								>
									<div className="flex items-baseline gap-2">
										<span
											className={clsx(
												"text-2xl font-semibold tabular-nums",
												card.alert ? "text-amber-400" : "text-neutral-100",
											)}
										>
											{card.value}
										</span>
										<span className="text-xs font-medium text-neutral-300">
											{card.label}
										</span>
									</div>
									<div className="mt-1 truncate text-[11px] text-neutral-500">
										{card.sub}
									</div>
								</button>
							))}
						</div>

						{/* Filter row */}
						<div className="mt-5 flex flex-wrap items-center gap-2">
							{stats.projectCount > 0 && (
								<Segmented
									value={sourceFilter}
									onChange={setSourceFilter}
									options={[
										{ value: "all", label: t("skills.filterSourceAll", { count: stats.total }) },
										{ value: "user", label: t("skills.filterSourceUser", { count: stats.userCount }) },
										{
											value: "project",
											label: t("skills.filterSourceProject", { count: stats.projectCount }),
										},
									]}
								/>
							)}
							<Segmented
								value={statusFilter}
								onChange={setStatusFilter}
								options={[
									{ value: "all", label: t("skills.filterStatusAll", { count: stats.total }) },
									{
										value: "active",
										label: t("skills.filterStatusActive", { count: usageUnavailable || usagePending ? "-" : stats.active }),
									},
									{
										value: "idle",
										label: t("skills.filterStatusIdle", { count: usageUnavailable || usagePending ? "-" : stats.idle }),
									},
									{ value: "issues", label: t("skills.filterStatusIssues", { count: stats.withIssues }) },
									{ value: "disabled", label: t("skills.filterStatusDisabled", { count: stats.disabled }) },
								]}
							/>
							<div className="flex-1" />
							<button
								ref={sortBtnRef}
								type="button"
								onClick={() => setSortOpen((v) => !v)}
								className={clsx(
									"flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
									sortOpen
										? "bg-[var(--bg-active-fill)] text-neutral-100"
										: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
								)}
							>
								<ArrowUpDown size={12} />
								<span>
									{t(SORT_OPTIONS.find((o) => o.value === sort)?.labelKey ?? "skills.sortName")}
								</span>
								<ChevronDown size={12} className="text-neutral-500" />
							</button>
							<FloatingLayer
								anchor={sortOpen ? sortBtnRef.current : null}
								placement="bottom-end"
								layer="menu"
								offset={6}
								onDismiss={() => setSortOpen(false)}
								ignoreRefs={[sortBtnRef]}
								className="w-40 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
							>
								{SORT_OPTIONS.map((o) => (
									<button
										key={o.value}
										type="button"
										onClick={() => {
											setSort(o.value);
											setSortOpen(false);
										}}
										className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<span>{t(o.labelKey)}</span>
										{sort === o.value && (
											<Check size={12} className="text-sky-400" />
										)}
									</button>
								))}
							</FloatingLayer>
						</div>

						<p className="mt-2 px-1 text-[11px] text-neutral-600">
							{t("skills.skillsSyncHint")}
						</p>

						{/* Skills table */}
						<div className="mt-3 overflow-hidden rounded-xl hairline bg-[var(--bg-panel)]/30">
							<div
								className={clsx(
									"grid items-center gap-3 border-b border-[var(--border-divider)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500",
									SKILL_COLS,
								)}
							>
								<span>{t("skills.thSkill")}</span>
								<span>{t("skills.thLocation")}</span>
								<span
									className="flex items-center justify-end gap-1"
									title={t("skills.triggersHint")}
								>
									{t("skills.thTriggers", { days })}
									<Info size={11} className="text-neutral-600" />
								</span>
								<span className="text-right">{t("skills.thLastTriggered")}</span>
								<span className="flex items-center justify-end gap-1">
									{t("skills.thEnable")}
									<EnableInfoButton />
								</span>
								<span className="text-right">{t("skills.thAction")}</span>
							</div>

							{!catalog ? (
								error ? (
									// Load failed — the error banner above carries the message.
									<div className="px-4 py-8 text-center text-[11px] text-neutral-600">
										{t("skills.cannotLoadCatalog")}
									</div>
								) : (
									<div className="space-y-px p-1">
										{Array.from({ length: 8 }).map((_, i) => (
											<div
												key={i}
												className="h-12 animate-pulse rounded-lg bg-neutral-800/30"
											/>
										))}
									</div>
								)
							) : sortPending ? (
								<div className="space-y-px p-1" aria-busy="true" data-testid="skills-sort-pending">
									{Array.from({ length: 8 }).map((_, i) => (
										<div
											key={i}
											className="h-12 animate-pulse rounded-lg bg-neutral-800/30"
										/>
									))}
								</div>
							) : visibleSkills.length === 0 ? (
								<EmptyState
									icon={Sparkles}
									title={hasSkillFilters ? t("skills.noMatchingSkillsTitle") : t("skills.noSkillsFoundTitle")}
									description={
										hasSkillFilters
											? t("skills.tryAnotherKeyword")
											: t("skills.noSkillsFoundDesc")
									}
								/>
							) : (
								visibleSkills.map((skill) => {
									const u = usage[skill.name];
									const enablement = resolveSkillEnablement(skill, skillConfig);
									const reason = enablement.reason;
									return (
										<div
											key={skill.path}
											role="button"
											tabIndex={0}
											onClick={() =>
												openDrawer({ kind: "skill", path: skill.path })
											}
											onKeyDown={(e) => {
												if (e.key === "Enter" && e.target === e.currentTarget)
													openDrawer({ kind: "skill", path: skill.path });
											}}
											style={{
												contentVisibility: "auto",
												containIntrinsicSize: "auto 52px",
											}}
											className={clsx(
												"grid cursor-pointer items-center gap-3 border-b border-[var(--border-divider)]/60 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--bg-hover)]/60",
												SKILL_COLS,
												!enablement.enabled && "opacity-60",
											)}
										>
											{/* Name + badges + description */}
											<div className="min-w-0">
												<div className="flex min-w-0 items-center gap-1.5">
													<span className="truncate text-[13px] font-semibold text-neutral-100">
														{skill.name}
													</span>
													<IssueBadges issues={skill.issues} />
													{skill.copies > 1 && (
														<span
															className="shrink-0 rounded bg-neutral-800 px-1 py-px text-[10px] text-neutral-500"
															title={t("skills.copiesTooltip")}
														>
															{t("skills.copiesBadge", { count: skill.copies })}
														</span>
													)}
													{reason && (
														<span
															className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-1 py-px text-[10px] font-medium text-neutral-400"
															title={describeDisabledReason(reason).detail}
														>
															{describeDisabledReason(reason).badge}
														</span>
													)}
												</div>
												<p
													className={clsx(
														"mt-0.5 truncate text-[11px]",
														skill.description
															? "text-neutral-500"
															: "italic text-neutral-600",
													)}
												>
													{skill.description || t("skills.noDescription")}
												</p>
											</div>

											{/* Install root */}
											<div className="min-w-0">
												<span
													className="inline-block max-w-full truncate rounded border border-[var(--border-divider)] bg-neutral-800/60 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400"
													title={skill.root || undefined}
												>
													{skill.root || "—"}
												</span>
											</div>

											{/* Trigger count */}
											<div
												className="text-right text-xs tabular-nums text-neutral-200"
												title={usageUnavailable ? t("skills.statsUnavailable") : undefined}
											>
												{usagePending ? (
													<span className="inline-block h-3 w-6 animate-pulse rounded bg-neutral-700/50" />
												) : usageUnavailable ? (
													<span className="text-neutral-600">—</span>
												) : (u?.count ?? 0) > 0 ? (
													u?.count
												) : (
													<span className="text-neutral-600">—</span>
												)}
											</div>

											{/* Last used */}
											<div
												className="text-right text-xs text-neutral-400"
												title={
													u?.lastUsedAt
														? absoluteTime(u.lastUsedAt)
														: usageUnavailable
															? t("skills.statsUnavailable")
															: undefined
												}
											>
												{usagePending ? (
													<span className="inline-block h-3 w-10 animate-pulse rounded bg-neutral-700/50" />
												) : u?.lastUsedAt ? (
													formatRelativeTime(u.lastUsedAt)
												) : (
													<span className="text-neutral-600">—</span>
												)}
											</div>

											{/* Enable switch */}
											<div className="flex justify-end">
												<SkillSwitch
													overridden={listOverridden}
													skill={skill}
													enabled={enablement.enabled}
													reason={reason}
													pending={togglingSkill === skill.path}
													onToggle={handleToggleSkill}
												/>
											</div>

											{/* Row actions */}
											<div className="flex items-center justify-end gap-1">
												<button
													type="button"
													disabled={!selectedSessionId || !skillUsable(skill)}
													onClick={(e) => {
														e.stopPropagation();
														insertSkillIntoComposer(skill, enablement.enabled);
													}}
													title={skillUseTitle(skill, enablement.enabled, !!selectedSessionId)}
													className={`${ROW_ACTION} hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300`}
												>
													<Play size={13} />
												</button>
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														revealInFinder(skill.dir || skill.path);
													}}
													title={t("skills.revealInFinder")}
													className={`${ROW_ACTION} hover:bg-[var(--bg-active-fill)] hover:text-neutral-100`}
												>
													<FolderOpen size={13} />
												</button>
												<button
													type="button"
													disabled={trashingDirs.includes(skill.dir)}
													onClick={(e) => {
														e.stopPropagation();
														setDeleteAnchor({ skill, el: e.currentTarget });
													}}
													title={t("skills.moveToTrash")}
													className={`${ROW_ACTION} hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400`}
												>
													<Trash2 size={13} />
												</button>
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														openDrawer({ kind: "skill", path: skill.path });
													}}
													title={t("skills.viewDetails")}
													className={`${ROW_ACTION} hover:bg-[var(--bg-active-fill)] hover:text-neutral-100`}
												>
													<ChevronRight size={14} />
												</button>
											</div>
										</div>
									);
								})
							)}
						</div>

						{usageUnavailable && (
							<div className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-amber-500/80">
								<AlertTriangle size={11} />
								<span title={usageError ?? undefined}>
									{t("skills.statsUnavailableNotice", { days })}
								</span>
							</div>
						)}
					</>
				)}

				{activeTab === "extensions" && (
					<div className="mt-5 overflow-hidden rounded-xl hairline bg-[var(--bg-panel)]/30">
						<div
							className={clsx(
								"grid items-center gap-3 border-b border-[var(--border-divider)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500",
								EXT_COLS,
							)}
						>
							<span>{t("skills.thName")}</span>
							<span>{t("skills.thSource")}</span>
							<span>{t("skills.thPath")}</span>
							<span className="text-right">{t("skills.thStatus")}</span>
						</div>
						{!catalog ? (
							error ? (
								<div className="px-4 py-8 text-center text-[11px] text-neutral-600">
									{t("skills.cannotLoadExtensions")}
								</div>
							) : (
								<div className="space-y-px p-1">
									{Array.from({ length: 4 }).map((_, i) => (
										<div
											key={i}
											className="h-12 animate-pulse rounded-lg bg-neutral-800/30"
										/>
									))}
								</div>
							)
						) : filteredExtensions.length === 0 ? (
							<EmptyState
								icon={Puzzle}
								title={searchQuery ? t("skills.noMatchingExtensionsTitle") : t("skills.noExtensionsAvailableTitle")}
								description={searchQuery ? t("skills.tryAnotherKeyword") : undefined}
							/>
						) : (
							filteredExtensions.map((ext) => (
								<div
									key={ext.path}
									role="button"
									tabIndex={0}
									onClick={() =>
										openDrawer({ kind: "extension", path: ext.path })
									}
									onKeyDown={(e) => {
										if (e.key === "Enter" && e.target === e.currentTarget)
											openDrawer({ kind: "extension", path: ext.path });
									}}
									style={{
										contentVisibility: "auto",
										containIntrinsicSize: "auto 52px",
									}}
									className={clsx(
										"grid cursor-pointer items-center gap-3 border-b border-[var(--border-divider)]/60 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--bg-hover)]/60",
										EXT_COLS,
									)}
								>
									<span className="min-w-0 truncate text-[13px] font-semibold text-neutral-100">
										{ext.name}
									</span>
									<span
										className={clsx(
											"w-fit rounded px-1.5 py-0.5 text-[10px] font-medium",
											ext.source === "project"
												? "border border-amber-500/20 bg-amber-500/10 text-amber-400"
												: "bg-neutral-800 text-neutral-400",
										)}
									>
										{sourceLabel(ext.source)}
									</span>
									<span
										className="min-w-0 truncate rounded border border-[var(--border-divider)] bg-neutral-800/60 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400"
										title={ext.path}
									>
										{ext.path}
									</span>
									<span className="flex items-center justify-end gap-2">
										{/* scope is stated once in the page banner; per-row repeat wrapped into vertical text */}
										<span
											className={clsx(
												"whitespace-nowrap text-[11px]",
												ext.enabled
													? "text-emerald-400"
													: "text-neutral-500",
											)}
										>
											{ext.enabled ? t("skills.extensionStatusEnabled") : t("skills.extensionStatusDisabled")}
										</span>
										<span
											title={
												listOverridden
													? PROJECT_OVERRIDE_TITLE()
													: ext.path.endsWith(".disabled") && !ext.enabled
														? DISABLED_FILE_HINT()
														: undefined
											}
										>
											<Switch
												checked={ext.enabled}
												disabled={togglingPath === ext.path || listOverridden}
												onChange={() => handleToggleExtension(ext)}
											/>
										</span>
									</span>
								</div>
							))
						)}
					</div>
				)}
			</div>

			{drawer && (
				<DetailDrawer
					target={drawer}
					onClose={closeDrawer}
					onToggleExtension={handleToggleExtension}
					togglingPath={togglingPath}
					onToggleSkill={handleToggleSkill}
					togglingSkill={togglingSkill}
					onTrashSkill={(s) => void trashSkill(s, projectCwd)}
					trashingDirs={trashingDirs}
				/>
			)}

			{/* Row delete confirmation popover */}
			<FloatingLayer
				anchor={deleteAnchor?.el ?? null}
				placement="bottom-end"
				layer="popover"
				offset={6}
				onDismiss={() => {
					if (!deleteBusy) setDeleteAnchor(null);
				}}
				className="p-3.5"
			>
				{deleteAnchor && (
					<DeleteConfirmBody
						skill={deleteAnchor.skill}
						busy={deleteBusy || trashingDirs.includes(deleteAnchor.skill.dir)}
						onCancel={() => setDeleteAnchor(null)}
						onConfirm={() => void handleConfirmDelete(deleteAnchor.skill)}
					/>
				)}
			</FloatingLayer>
		</div>
	);
}
