/**
 * Settings ▸ 通用 (`general`): new-session defaults, UI switches, shortcut, Git delivery,
 * plus the omp 系统 section (sleep prevention).
 */
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "../../../components/Segmented";
import { ompConfigSet } from "../../../lib/ipc";
import { toModelKey } from "../../../lib/models";
import { formatShortModel } from "../../chat/turnGrouping";
import { asRecord, roleValue, splitRoleValue } from "../modelRoles";
import { useOmpConfigStore } from "../ompConfigStore";
import { useSettingsNav } from "../settingsNav";
import { openSettingsTarget } from "../settingsTargets";
import { DEFAULT_SETTINGS } from "../store";
import { useAppSettings, useCatalogModels } from "../useAppSettings";
import { OmpSections } from "../OmpSettingsList";
import {
	Button,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	useSaveStatus,
} from "../ui";
import { ShortcutRecorder } from "./ShortcutRecorder";

type ApprovalMode = "always-ask" | "write" | "yolo";

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; desc: string }[] = [
	{ value: "always-ask", label: "每步都问", desc: "AI 每次执行命令或改文件前都先询问确认，最稳妥。" },
	{ value: "write", label: "改动前问", desc: "只读与搜索自动进行；改文件或跑命令前先询问确认（推荐）。" },
	{ value: "yolo", label: "全自动", desc: "AI 直接修改文件与执行命令，无需确认（速度快，误操作不被拦截）。" },
];
const APPROVAL_SUMMARY = APPROVAL_OPTIONS.map((o) => `${o.label}：${o.desc}`).join("");

export function GeneralSection() {
	const { settings, save } = useAppSettings();
	const { models } = useCatalogModels();
	const { navigate } = useSettingsNav();
	const approvalSave = useSaveStatus();
	const shortcutSave = useSaveStatus();
	const ompEntries = useOmpConfigStore((s) => s.entries);
	const ompLoaded = useOmpConfigStore((s) => s.loaded);
	const loadOmp = useOmpConfigStore((s) => s.load);

	// Cache last known default role in localStorage so frame 1 renders accurately
	const [cachedRole, setCachedRole] = useState<string | null>(() => {
		try {
			return localStorage.getItem("ompws:cached-default-role");
		} catch {
			return null;
		}
	});

	useEffect(() => {
		void loadOmp();
	}, [loadOmp]);

	// ── Global default model (OMP modelRoles.default) ──
	const currentRoles = asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value);
	const liveRole = roleValue(currentRoles, "default");
	const defaultRole = (ompLoaded ? liveRole : (cachedRole ?? liveRole)) ?? null;

	useEffect(() => {
		if (ompLoaded && liveRole) {
			try {
				localStorage.setItem("ompws:cached-default-role", liveRole);
				setCachedRole(liveRole);
			} catch {
				/* ignore */
			}
		}
	}, [ompLoaded, liveRole]);

	const defaultSelector = defaultRole ? splitRoleValue(defaultRole).selector : "";
	const matchedModel = models.find((m) => toModelKey(m.provider, m.id) === defaultSelector);
	const fallbackShortName = defaultSelector ? formatShortModel(defaultSelector) : "";
	// ModelSelect appends " · <level>" itself when currentValue carries a suffix.
	const modelLabel = defaultRole
		? (matchedModel?.id ?? (fallbackShortName || defaultRole))
		: (ompLoaded ? "OMP 内置默认" : "加载中");

	const approval = (settings?.defaultApprovalMode ?? "write") as ApprovalMode;
	const currentApprovalOption = APPROVAL_OPTIONS.find((o) => o.value === approval) ?? APPROVAL_OPTIONS[1];

	return (
		<div className="space-y-6">
			<SectionHeader title="通用" description="新会话的默认设置、界面开关与快捷键" />

			<SettingsCard title="新会话默认设置">
				<SettingRow
					fieldId="newSessionModel"
					label="全局默认模型"
					description="新对话与常规问答默认使用的主力模型，在「模型角色」中修改。"
					control={
						<div className="flex min-w-0 items-center gap-2">
							<span className="min-w-0 truncate text-xs text-[var(--text-muted)]" title={defaultRole ?? undefined}>
								{modelLabel}
							</span>
							<Button size="sm" variant="ghost" onClick={() => openSettingsTarget("models")}>
								去模型角色修改
								<ChevronRight className="h-3 w-3" />
							</Button>
						</div>
					}
				/>

				<SettingRow
					fieldId="defaultApprovalMode"
					label="审批模式"
					description={APPROVAL_SUMMARY}
					hint={`当前：${currentApprovalOption.label}`}
					status={approvalSave.status}
					statusError={approvalSave.error}
					control={
						<Segmented
							value={approval}
							onChange={(v) =>
								void approvalSave.run(async () => {
									await save({ defaultApprovalMode: v });
									try {
										await ompConfigSet("tools.approvalMode", v);
										await loadOmp(true);
									} catch {
										// Ignore if omp tool schema differs
									}
								})
							}
							options={APPROVAL_OPTIONS.map((o) => ({
								value: o.value,
								title: o.desc,
								label:
									o.value === "yolo" ? (
										<span className="inline-flex items-center gap-1 text-[var(--status-warning)]">
											<AlertTriangle className="h-3 w-3" />
											{o.label}
										</span>
									) : (
										o.label
									),
							}))}
						/>
					}
				/>

				<SettingRow
					fieldId="agentsMdShortcut"
					label="长期规则"
					description="希望 AI 每次都遵守的习惯与约定（代码风格、回复语言等）写在 AGENTS.md 里。"
					control={
						<Button size="sm" variant="ghost" onClick={() => navigate("agents-md")}>
							去规则文件编辑
							<ChevronRight className="h-3 w-3" />
						</Button>
					}
				/>
			</SettingsCard>

			<SettingsCard title="界面">
				<ToggleRow
					fieldId="capsuleVisible"
					label="顶部子代理胶囊"
					description="会话派生并发子代理时，在窗口顶部栏显示胶囊，点击可查看各子代理的进度与详情。"
					checked={settings?.capsuleVisible ?? true}
					onChange={(v) => save({ capsuleVisible: v })}
				/>
				<ToggleRow
					fieldId="windowWorktreeTitle"
					label="窗口标题显示分支名"
					description="在系统窗口标题中附加当前工作树的 Git 分支，同时打开多个实例时便于区分；立即生效。"
					checked={settings?.windowWorktreeTitle ?? true}
					onChange={(v) => save({ windowWorktreeTitle: v })}
				/>
				<ToggleRow
					fieldId="smartContextRouting"
					label="自动关联项目"
					description="新开对话时自动识别你在做哪个项目，并把最近的相关工作告诉 AI。"
					checked={settings?.smartContextRouting ?? true}
					onChange={(v) => save({ smartContextRouting: v })}
				/>
			</SettingsCard>

			<SettingsCard title="快捷键">
				<SettingRow
					fieldId="quickCaptureShortcut"
					label="快速记录快捷键"
					description="在任何应用里按下它，都能弹出快速记录窗口。点击按钮后按下新的组合键即可更换。"
					hint="清除即停用；需包含 ⌘ / ⌃ / ⌥ / ⇧ 之一（F 键除外）"
					status={shortcutSave.status}
					statusError={shortcutSave.error}
					control={
						<ShortcutRecorder
							value={settings?.quickCaptureShortcut ?? ""}
							defaultValue={DEFAULT_SETTINGS.quickCaptureShortcut}
							onCommit={(v) => void shortcutSave.run(() => save({ quickCaptureShortcut: v }))}
						/>
					}
				/>
			</SettingsCard>

			<SettingsCard title="Git">
				<SettingRow
					fieldId="gitDeliveryMode"
					label="主干交付模式"
					description="把功能分支交付到主干时的默认方式。"
					hint="推荐发起 Pull Request，经网页审查后再合并"
					control={
						<Segmented
							value={(settings?.gitDeliveryMode as "pr" | "direct") ?? "pr"}
							onChange={(v) => void save({ gitDeliveryMode: v })}
							options={[
								{
									value: "pr",
									label: "发起 Pull Request（推荐）",
									title: "推送到云端同名分支并自动打开 GitHub 网页发起 PR 评审",
								},
								{
									value: "direct",
									label: "本地合并并直接推送",
									title: "本地合并入主干后直接推送到云端 origin/main（适合个人单人快速开发）",
								},
							]}
						/>
					}
				/>
			</SettingsCard>

			<OmpSections page="general" />
		</div>
	);
}
