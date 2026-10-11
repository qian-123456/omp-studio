import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertCircle,
	AlertTriangle,
	ArrowUpDown,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	FolderOpen,
	Info,
	MessageSquarePlus,
	Play,
	Power,
	Puzzle,
	RefreshCw,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloatingLayer, Z_LAYER } from "../../components/FloatingLayer";
import { Segmented } from "../../components/Segmented";
import type { ExtensionItem, SkillIssue, SkillItem } from "../../lib/contracts";
import { copyText, errMsg } from "../../lib/dialogs";
import { absoluteTime } from "../../lib/format";
import { useEscapeKey } from "../../lib/hooks";
import { skillsRead } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { Markdown } from "../chat/markdown";
import { formatRelativeTime } from "../schedules/humanCadence";
import { Switch } from "../settings/Switch";
import {
	SKILL_BUDGET_CHARS,
	USAGE_DAYS,
	computeSkillStats,
	resolveSkillEnablement,
	selectVisibleSkills,
	updateOmpListSetting,
	useSkillsStore,
	type SkillDisabledReason,
	type SkillSort,
	type SkillsDrawerTarget,
} from "./store";

/** Drop a leading YAML frontmatter block; name/description are shown in the header. */
function stripFrontmatter(text: string): string {
	const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	return m ? text.slice(m[0].length).trimStart() : text;
}

const ISSUE_META: Record<SkillIssue, { label: string; explain: string }> = {
	missing_description: {
		label: "缺描述",
		explain:
			"SKILL.md 的 frontmatter 缺少 description，模型难以判断何时该调用它。",
	},
	description_too_long: {
		label: "描述超长",
		explain:
			"description 超过 1024 字符上限（Agent Skills 规范），注入系统提示时会被截断并白白占用上下文。",
	},
	unreadable: {
		label: "不可读",
		explain:
			"SKILL.md 读取或 frontmatter 解析失败（也可能是目录符号链接失效），该技能大概率无法正常工作。",
	},
};

const ISSUE_ORDER: SkillIssue[] = [
	"unreadable",
	"description_too_long",
	"missing_description",
];

const TRIGGERS_HINT =
	"模型从技能目录自动识别并调用的次数（含手动 /skill: 调用）";

const sourceLabel = (source: string) =>
	source === "project" ? "项目级" : "全局";

const SORT_OPTIONS: { value: SkillSort; label: string }[] = [
	{ value: "count", label: "按触发次数" },
	{ value: "lastUsed", label: "按最后触发" },
	{ value: "name", label: "按名称" },
];

/** Short badge + explanatory text for why a skill is off for new sessions. */
function describeDisabledReason(reason: SkillDisabledReason): {
	badge: string;
	detail: string;
} {
	switch (reason.kind) {
		case "disabled":
			return { badge: "已停用", detail: "已在 disabledExtensions 中停用" };
		case "source":
			return {
				badge: "来源已关闭",
				detail: `来源已关闭：${reason.key} = false`,
			};
		case "ignored":
			return reason.exact
				? {
						badge: "已忽略",
						detail: "已被 skills.ignoredSkills 按名称忽略",
					}
				: {
						badge: "已忽略",
						detail: `被忽略规则 ${reason.pattern} 匹配`,
					};
		case "not_included":
			return {
				badge: "未纳入",
				detail: "不在 skills.includeSkills 白名单内",
			};
		case "all_off":
			return {
				badge: "全部关闭",
				detail: "skills.enabled = false，所有技能已整体关闭",
			};
	}
}

/** A locked Switch can't take a title — wrap it so tooltips still work. */
function SkillSwitch({
	skill,
	enabled,
	reason,
	pending,
	onToggle,
}: {
	skill: SkillItem;
	enabled: boolean;
	reason: SkillDisabledReason | null;
	pending: boolean;
	onToggle: (skill: SkillItem, next: boolean) => void;
}) {
	const locked =
		reason !== null &&
		reason.kind !== "disabled" &&
		!(reason.kind === "ignored" && reason.exact);
	return (
		<span
			className="inline-flex"
			title={
				pending
					? "更新中…"
					: reason
						? describeDisabledReason(reason).detail
						: enabled
							? "停用后新会话不再加载该技能"
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
	return (
		<div className="w-64">
			<p className="text-xs leading-relaxed text-neutral-200">
				将把「{skill.name}」整个目录移到废纸篓，可从废纸篓恢复。
			</p>
			<p
				className="mt-1.5 truncate font-mono text-[11px] text-neutral-500"
				title={skill.dir}
			>
				{skill.dir}
			</p>
			{skill.copies > 1 && (
				<p className="mt-1.5 text-[11px] leading-relaxed text-amber-400/90">
					另有 {skill.copies - 1} 处同名副本不受影响，删除后可能由它们生效
				</p>
			)}
			<div className="mt-3 flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 disabled:opacity-50"
				>
					取消
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
				>
					<Trash2 size={12} />
					移到废纸篓
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
function insertSkillIntoComposer(skill: SkillItem, enabled: boolean) {
	const selectedSessionId = useUi.getState().selectedSessionId;
	if (!selectedSessionId) {
		toast.error("当前未选择会话，请先在侧边栏选择一个会话");
		return;
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
			? `已插入 /skill:${skill.name} 到会话输入框`
			: `「${skill.name}」已停用，已插入“读取该 Skill 文件”的指令`,
	);
}

const skillUseTitle = (skill: SkillItem, enabled: boolean, hasSession: boolean) =>
	!hasSession
		? "请先在侧边栏选择一个会话"
		: enabled
			? `在当前会话插入 /skill:${skill.name}`
			: "已停用：/skill 命令不可用，将插入“读取该 Skill 文件”的指令临时使用";

/** Info circle next to the 启用 column header explaining what the switch does. */
function EnableInfoButton() {
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
				aria-label="启用开关说明"
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
				aria-label="启用开关说明"
				className="w-[260px] rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-left text-[12px] font-normal normal-case leading-relaxed tracking-normal text-neutral-300 shadow-2xl"
			>
				<div className="mb-1.5 font-semibold text-neutral-100">这个开关做什么</div>
				<ul className="list-disc space-y-1 pl-4 text-neutral-400">
					<li>关掉后，新开的对话里 AI 用不了这个 Skill</li>
					<li>不删文件，不影响正在进行的对话</li>
					<li>开关点不动：这一整类 Skill 在设置里被统一关了，鼠标放上去能看到是哪一项</li>
					<li>想临时用一次：点 ▶</li>
				</ul>
			</FloatingLayer>
		</>
	);
}

async function revealInFinder(path: string) {
	try {
		await revealItemInDir(path);
	} catch (err) {
		toast.error(`在访达中显示失败: ${errMsg(err)}`);
	}
}

function IssueBadges({ issues }: { issues: SkillIssue[] }) {
	return (
		<>
			{ISSUE_ORDER.filter((i) => issues.includes(i)).map((issue) => (
				<span
					key={issue}
					title={ISSUE_META[issue].explain}
					className={clsx(
						"shrink-0 rounded border px-1 py-px text-[10px] font-medium",
						issue === "unreadable"
							? "border-red-500/25 bg-red-500/10 text-red-400"
							: "border-amber-500/25 bg-amber-500/10 text-amber-400",
					)}
				>
					{ISSUE_META[issue].label}
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
	const catalog = useSkillsStore((s) => s.catalog);
	const skillConfig = useSkillsStore((s) => s.skillConfig);
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
									{extension.enabled ? "已启用" : "已停用"}
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
										? "已停用：OMP 不会注册这个命令"
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
						title="关闭 (Esc)"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						<X size={14} />
					</button>
				</div>

				{/* Scrollable body */}
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{/* Copyable paths */}
					{[
						{ label: "安装位置", value: skill ? skill.root : null },
						{
							label: skill ? "SKILL.md 路径" : "文件路径",
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
								<button
									type="button"
									title={`复制${r.label}`}
									onClick={() => {
										copyText(r.value)
											.then(() => toast.success("已复制路径"))
											.catch((e) => toast.error(`复制失败: ${errMsg(e)}`));
									}}
									className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
								>
									<Copy size={12} />
								</button>
							</div>
						))}

					{/* Meta grid */}
					{skill ? (
						<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl hairline bg-[var(--well-bg)]/40 p-3.5 text-xs">
							<div>
								<dt className="text-neutral-500">目录名</dt>
								<dd className="mt-0.5 font-mono text-neutral-200">{dirName}</dd>
							</div>
							<div>
								<dt className="text-neutral-500">来源</dt>
								<dd className="mt-0.5 text-neutral-200">
									{sourceLabel(skill.source)}
								</dd>
							</div>
							<div>
								<dt className="text-neutral-500">触发统计</dt>
								<dd className="mt-0.5 text-neutral-200">
									{usageError ? (
										<span title={usageError}>统计不可用</span>
									) : (itemUsage?.count ?? 0) > 0 ? (
										<>
											{days} 天内 {itemUsage?.count} 次
											{itemUsage?.lastUsedAt && (
												<span className="text-neutral-500">
													{" "}
													· 最后 {formatRelativeTime(itemUsage.lastUsedAt)}
												</span>
											)}
										</>
									) : itemUsage?.lastUsedAt ? (
										<span className="text-neutral-400">
											最后 {formatRelativeTime(itemUsage.lastUsedAt)}
										</span>
									) : (
										<span className="text-neutral-500">从未触发</span>
									)}
								</dd>
							</div>
							<div>
								<dt className="text-neutral-500">副本数</dt>
								<dd className="mt-0.5 text-neutral-200">
									{skill.copies > 1
										? `${skill.copies} 处（按优先级生效此处）`
										: "1"}
								</dd>
							</div>
							<div className="col-span-2">
								<dt className="text-neutral-500">问题</dt>
								<dd className="mt-0.5">
									{issues.length === 0 ? (
										<span className="text-emerald-400/90">无</span>
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
									<dt className="text-neutral-500">扩展标识</dt>
									<dd className="mt-0.5 font-mono text-neutral-200">
										{extension.name}
									</dd>
								</div>
								<div>
									<dt className="text-neutral-500">来源</dt>
									<dd className="mt-0.5 text-neutral-200">
										{sourceLabel(extension.source)}
									</dd>
								</div>
								<div className="col-span-2">
									<dt className="text-neutral-500">状态</dt>
									<dd className="mt-0.5 text-neutral-200">
										{extension.enabled
											? "已启用（将在会话启动时加载）"
											: "已停用（在 disabledExtensions 配置中）"}
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
										{ISSUE_META[issue].label}：
									</span>
									{ISSUE_META[issue].explain}
								</p>
							))}
						</div>
					)}

					{/* Actions */}
					<div className="mt-4 flex items-center gap-2">
						{skill && (
							<button
								type="button"
								onClick={() => insertSkillIntoComposer(skill, enablement?.enabled ?? true)}
								disabled={!selectedSessionId}
								title={skillUseTitle(skill, enablement?.enabled ?? true, !!selectedSessionId)}
								className={clsx(
									"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95",
									selectedSessionId
										? "bg-amber-600/90 text-white hover:bg-amber-500"
										: "cursor-not-allowed bg-neutral-800 text-neutral-500 opacity-50",
								)}
							>
								<MessageSquarePlus size={13} />
								<span>在当前会话中使用</span>
							</button>
						)}
						{skill && enablement && (
							<span
								className="inline-flex"
								title={
									skillLocked && enablement.reason
										? describeDisabledReason(enablement.reason).detail
										: "启用/停用写入 OMP 配置，对新会话生效"
								}
							>
								<button
									type="button"
									disabled={skillLocked || togglingSkill === skill.path}
									onClick={() => onToggleSkill(skill, !enablement.enabled)}
									className={clsx(
										"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95 disabled:opacity-50",
										enablement.enabled
											? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
											: "bg-emerald-600 text-white hover:bg-emerald-500",
									)}
								>
									<Power size={13} />
									<span>{enablement.enabled ? "停用" : "启用"}</span>
								</button>
							</span>
						)}
						{extension && (
							<button
								type="button"
								disabled={togglingPath === extension.path}
								onClick={() => onToggleExtension(extension)}
								className={clsx(
									"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-apple-card hairline transition-all active:scale-95 disabled:opacity-50",
									extension.enabled
										? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
										: "bg-emerald-600 text-white hover:bg-emerald-500",
								)}
							>
								<Power size={13} />
								<span>{extension.enabled ? "停用扩展" : "启用扩展"}</span>
							</button>
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
							<span>在访达中显示</span>
						</button>
						{skill && (
							<button
								type="button"
								disabled={trashingDirs.includes(skill.dir)}
								onClick={() => setConfirmDelete(true)}
								title="把该技能目录移到废纸篓"
								className="flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 active:scale-95 disabled:opacity-50"
							>
								<Trash2 size={13} />
								<span>删除</span>
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
										<span>读取技能文档失败</span>
									</div>
									<p className="mt-1 text-neutral-400">{doc.error}</p>
								</div>
							) : doc.text ? (
								<Markdown text={doc.text} />
							) : (
								<div className="flex h-24 items-center justify-center text-xs text-neutral-500">
									文档内容为空
								</div>
							)}
						</div>
					)}

					{extension && (
						<div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 text-xs leading-relaxed text-neutral-400">
							<p className="mb-1 font-medium text-sky-300">关于 OMP 扩展机制</p>
							<p>
								扩展通过 OMP 原生扩展系统运行，能够介入工具调用、拦截消息流并增强模型能力。
								启用/停用状态通过 OMP 配置项{" "}
								<code className="rounded bg-sky-950/60 px-1 py-0.5 font-mono text-sky-200">
									disabledExtensions
								</code>{" "}
								实时同步。
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
	const catalog = useSkillsStore((s) => s.catalog);
	const loading = useSkillsStore((s) => s.loading);
	const error = useSkillsStore((s) => s.error);
	const activeTab = useSkillsStore((s) => s.activeTab);
	const searchQuery = useSkillsStore((s) => s.searchQuery);
	const sourceFilter = useSkillsStore((s) => s.sourceFilter);
	const skillConfig = useSkillsStore((s) => s.skillConfig);
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
	const updateExtensionEnabled = useSkillsStore((s) => s.updateExtensionEnabled);

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
			await updateOmpListSetting("disabledExtensions", (currentDisabled) =>
				ext.enabled
					? Array.from(new Set([...currentDisabled, ext.name]))
					: currentDisabled.filter(
							(id) =>
								id !== ext.name &&
								id !== `extension-module:${ext.name}` &&
								id !== ext.path,
						),
			);
			updateExtensionEnabled(ext.path, !ext.enabled);
			toast.success(
				ext.enabled ? `已禁用扩展 ${ext.name}` : `已启用扩展 ${ext.name}`,
			);
		} catch (err) {
			toast.error(`更新扩展状态失败: ${errMsg(err)}`);
		} finally {
			setTogglingPath(null);
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
	const usageUnavailable = !!usageError && !usageReport;
	const days = usageReport?.days ?? USAGE_DAYS;

	const budgetUsed = stats.budgetUsed;
	const budgetPct = budgetUsed / SKILL_BUDGET_CHARS;
	const budgetOver = budgetPct > 1;

	const statCards: {
		key: "all" | "active" | "idle" | "issues";
		label: string;
		value: string | number;
		sub: string;
		alert?: boolean;
	}[] = [
		{
			key: "all",
			label: "全部 skills",
			value: stats.total,
			sub: `全局 ${stats.userCount} + 项目级 ${stats.projectCount}`,
		},
		{
			key: "active",
			label: "近期活跃",
			value: usageUnavailable ? "—" : usagePending ? "…" : stats.active,
			sub: usageUnavailable ? "统计不可用" : `共 ${stats.totalTriggers} 次触发`,
		},
		{
			key: "idle",
			label: "在吃灰",
			value: usageUnavailable ? "—" : usagePending ? "…" : stats.idle,
			sub: `${days} 天零触发`,
		},
		{
			key: "issues",
			label: "有问题",
			value: stats.withIssues,
			sub: "缺描述 / 超长 / 不可读",
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
							{ value: "skills", label: `我的 Skill ${stats.total}` },
							{
								value: "extensions",
								label: `扩展 ${catalog?.extensions.length ?? 0}`,
							},
						]}
					/>
					<div className="flex-1" />
					<div className="relative flex w-56 items-center sm:w-64">
						<Search
							size={13}
							className="pointer-events-none absolute left-2.5 text-neutral-400"
						/>
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder={
								activeTab === "skills" ? "搜索 Skill…" : "搜索扩展…"
							}
							className="h-8 w-full rounded-lg hairline bg-[var(--well-bg)] pl-8 pr-7 text-xs text-neutral-100 placeholder-neutral-500 transition-all focus:outline-none focus:ring-1 focus:ring-amber-500/50"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery("")}
								className="absolute right-2 flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:text-neutral-200"
							>
								<X size={12} />
							</button>
						)}
					</div>
					<button
						type="button"
						onClick={() => refresh(projectCwd)}
						disabled={loading}
						title="刷新 Skill 列表与触发统计"
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

				{/* Error banner */}
				{error && (
					<div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-300">
						<div className="flex min-w-0 items-center gap-2">
							<AlertCircle size={14} className="shrink-0" />
							<span className="truncate">加载失败：{error}</span>
						</div>
						<button
							type="button"
							onClick={() => refresh(projectCwd)}
							className="shrink-0 rounded-md border border-red-500/30 px-2.5 py-1 font-medium text-red-200 transition-colors hover:bg-red-500/20"
						>
							重试
						</button>
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

							{/* Resident context budget */}
							<div className="col-span-2 flex flex-col justify-center rounded-xl hairline bg-[var(--bg-panel)]/50 px-4 py-3">
								<div className="flex items-center justify-between text-xs">
									<span className="font-medium text-neutral-300">
										常驻上下文占用
									</span>
									{budgetOver ? (
										<span className="font-medium text-red-400">
											≈超限 {budgetPct.toFixed(1)}×
										</span>
									) : (
										<span className="text-neutral-500">
											{Math.round(budgetPct * 100)}%
										</span>
									)}
								</div>
								<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
									<div
										className={clsx(
											"h-full rounded-full transition-all",
											budgetOver
												? "bg-red-500"
												: budgetPct > 0.8
													? "bg-amber-400"
													: "bg-emerald-500/80",
										)}
										style={{
											width: `${Math.min(100, Math.round(budgetPct * 100))}%`,
										}}
									/>
								</div>
								<div className="mt-1.5 text-[11px] text-neutral-500">
									{budgetUsed.toLocaleString()} 字符 / 建议上限约{" "}
									{SKILL_BUDGET_CHARS.toLocaleString()}（估算）
								</div>
								{budgetOver && (
									<div className="mt-1 text-[11px] text-amber-500/90">
										超限越多，每轮固定开销越大，技能触发越不准
									</div>
								)}
							</div>
						</div>

						{/* Filter row */}
						<div className="mt-5 flex flex-wrap items-center gap-2">
							<Segmented
								value={sourceFilter}
								onChange={setSourceFilter}
								options={[
									{ value: "all", label: `全部来源 ${stats.total}` },
									{ value: "user", label: `全局 ${stats.userCount}` },
									{
										value: "project",
										label: `项目级 ${stats.projectCount}`,
									},
								]}
							/>
							<Segmented
								value={statusFilter}
								onChange={setStatusFilter}
								options={[
									{ value: "all", label: `全部状态 ${stats.total}` },
									{
										value: "active",
										label: `活跃 ${usageUnavailable ? "—" : usagePending ? "…" : stats.active}`,
									},
									{
										value: "idle",
										label: `未触发 ${usageUnavailable ? "—" : usagePending ? "…" : stats.idle}`,
									},
									{ value: "issues", label: `有问题 ${stats.withIssues}` },
									{ value: "disabled", label: `已停用 ${stats.disabled}` },
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
									{SORT_OPTIONS.find((o) => o.value === sort)?.label}
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
										<span>{o.label}</span>
										{sort === o.value && (
											<Check size={12} className="text-sky-400" />
										)}
									</button>
								))}
							</FloatingLayer>
						</div>

						<p className="mt-2 px-1 text-[11px] text-neutral-600">
							启用/停用写入 OMP 配置，对新会话生效
						</p>

						{/* Skills table */}
						<div className="mt-3 overflow-hidden rounded-xl hairline bg-[var(--bg-panel)]/30">
							<div
								className={clsx(
									"grid items-center gap-3 border-b border-[var(--border-divider)] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500",
									SKILL_COLS,
								)}
							>
								<span>SKILL</span>
								<span>安装位置</span>
								<span
									className="flex items-center justify-end gap-1"
									title={TRIGGERS_HINT}
								>
									{days} 天触发
									<Info size={11} className="text-neutral-600" />
								</span>
								<span className="text-right">最后触发</span>
								<span className="flex items-center justify-end gap-1">
									启用
									<EnableInfoButton />
								</span>
								<span className="text-right">操作</span>
							</div>

							{!catalog ? (
								error ? (
									// Load failed — the error banner above carries the message.
									<div className="px-4 py-8 text-center text-[11px] text-neutral-600">
										无法加载技能目录
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
							) : visibleSkills.length === 0 ? (
								<div className="flex flex-col items-center justify-center gap-1.5 px-8 py-14 text-center">
									<Sparkles size={26} className="text-neutral-600" />
									<span className="text-xs font-medium text-neutral-400">
										{hasSkillFilters
											? "没有符合筛选的 Skill"
											: "没有发现任何 Skill"}
									</span>
									<span className="text-[11px] text-neutral-600">
										{hasSkillFilters
											? "换个关键词试试吧"
											: "将 SKILL.md 放入 ~/.omp/agent/skills 或项目 .omp/skills 目录即可被发现"}
									</span>
								</div>
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
												if (e.key === "Enter")
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
															title="多个发现位置包含同名技能，按优先级生效此处"
														>
															{skill.copies} 处副本
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
													{skill.description || "暂无描述"}
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
												title={usageUnavailable ? "统计不可用" : undefined}
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
															? "统计不可用"
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
													skill={skill}
													enabled={enablement.enabled}
													reason={reason}
													pending={togglingSkill === skill.path}
													onToggle={handleToggleSkill}
												/>
											</div>

											{/* Row actions */}
											<div className="flex items-center justify-end gap-0.5">
												<button
													type="button"
													disabled={!selectedSessionId}
													onClick={(e) => {
														e.stopPropagation();
														insertSkillIntoComposer(skill, enablement.enabled);
													}}
													title={skillUseTitle(skill, enablement.enabled, !!selectedSessionId)}
													className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[var(--bg-active-fill)] hover:text-amber-300 disabled:opacity-30"
												>
													<Play size={13} />
												</button>
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														revealInFinder(skill.dir || skill.path);
													}}
													title="在访达中显示"
													className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
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
													title="移到废纸篓"
													className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
												>
													<Trash2 size={13} />
												</button>
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														openDrawer({ kind: "skill", path: skill.path });
													}}
													title="查看详情"
													className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
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
									触发统计不可用（{days} 天扫描失败），列表按目录排序显示
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
							<span>名称</span>
							<span>来源</span>
							<span>路径</span>
							<span className="text-right">状态</span>
						</div>
						{!catalog ? (
							error ? (
								<div className="px-4 py-8 text-center text-[11px] text-neutral-600">
									无法加载扩展列表
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
							<div className="flex flex-col items-center justify-center gap-1.5 px-8 py-14 text-center">
								<Puzzle size={26} className="text-neutral-600" />
								<span className="text-xs font-medium text-neutral-400">
									{searchQuery ? "没有符合筛选的扩展" : "暂无可用的扩展"}
								</span>
								{searchQuery && (
									<span className="text-[11px] text-neutral-600">
										换个关键词试试吧
									</span>
								)}
							</div>
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
										if (e.key === "Enter")
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
										<span
											className={clsx(
												"text-[11px]",
												ext.enabled
													? "text-emerald-400"
													: "text-neutral-500",
											)}
										>
											{ext.enabled ? "已启用" : "已停用"}
										</span>
										<Switch
											checked={ext.enabled}
											disabled={togglingPath === ext.path}
											onChange={() => handleToggleExtension(ext)}
										/>
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
				onDismiss={() => setDeleteAnchor(null)}
				className="p-3.5"
			>
				{deleteAnchor && (
					<DeleteConfirmBody
						skill={deleteAnchor.skill}
						busy={trashingDirs.includes(deleteAnchor.skill.dir)}
						onCancel={() => setDeleteAnchor(null)}
						onConfirm={() => {
							const s = deleteAnchor.skill;
							setDeleteAnchor(null);
							void trashSkill(s, projectCwd);
						}}
					/>
				)}
			</FloatingLayer>
		</div>
	);
}
