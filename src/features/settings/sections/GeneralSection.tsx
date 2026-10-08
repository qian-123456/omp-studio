/**
 * Settings ▸ 通用 (`general`): the handful of things most users change —
 * global default model, approval mode, UI/shortcut, AGENTS.md entry.
 */
import { AlertTriangle, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ModelSelect, type ModelExtraOption } from "../../../components/ModelSelect";
import { Segmented } from "../../../components/Segmented";
import { ompConfigSet } from "../../../lib/ipc";
import { toModelKey } from "../../../lib/models";
import { toast } from "../../../lib/toast";
import { formatShortModel } from "../../chat/turnGrouping";
import { asRecord, roleValue, splitRoleValue, withRoleAssignment } from "../modelRoles";
import { useOmpConfigStore } from "../ompConfigStore";
import { useSettingsNav } from "../settingsNav";
import { DEFAULT_SETTINGS } from "../store";
import { useAppSettings, useModelCatalog } from "../useAppSettings";
import {
	CommitInput,
	MODEL_PICKER_BUTTON_CLASS,
	SETTINGS_BUTTON_CLASS,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
	useSaveStatus,
} from "../ui";
import { ShortcutRecorder } from "./ShortcutRecorder";

const MODEL_EXTRAS: ModelExtraOption[] = [
	{ value: "__custom", label: "手动输入模型…", hint: "自定义" },
];

type ApprovalMode = "always-ask" | "write" | "yolo";

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; desc: string }[] = [
	{ value: "always-ask", label: "每步都问", desc: "AI 每次执行命令或改文件前都先询问确认，最稳妥。" },
	{ value: "write", label: "改动前问", desc: "只读与搜索自动进行；改文件或跑命令前先询问确认（推荐）。" },
	{ value: "yolo", label: "全自动", desc: "AI 直接修改文件与执行命令，无需确认（速度快，误操作不被拦截）。" },
];

export function GeneralSection() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys, loaded: catalogLoaded } = useModelCatalog();
	const { navigate } = useSettingsNav();
	const approvalSave = useSaveStatus();
	const modelSave = useSaveStatus();
	const shortcutSave = useSaveStatus();
	const [customOpen, setCustomOpen] = useState(false);

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
		? (matchedModel?.name ?? (fallbackShortName || defaultRole))
		: (ompLoaded ? "OMP 内置默认" : "加载中…");

	const showCustom =
		customOpen || (Boolean(defaultRole) && catalogLoaded && !catalogKeys.has(defaultSelector ?? ""));

	const approval = (settings?.defaultApprovalMode ?? "write") as ApprovalMode;
	const currentApprovalOption = APPROVAL_OPTIONS.find((o) => o.value === approval) ?? APPROVAL_OPTIONS[1];

	return (
		<div className="space-y-6">
			<SectionHeader title="通用" description="最常改的几项：全局主力模型、工具审批模式、界面与快捷键" />

			<SettingsCard title="模型与审批">
				<SettingRow
					fieldId="newSessionModel"
					label="全局默认模型 (主力模型)"
					description="新对话与常规问答默认使用的主力模型（对应 OMP 全局 default 角色）。"
					status={modelSave.status}
					statusError={modelSave.error}
					control={
						<ModelSelect
							direction="down"
							align="end"
							widthClass="w-[380px]"
							label={modelLabel}
							buttonClass={MODEL_PICKER_BUTTON_CLASS}
							models={models}
							currentValue={catalogKeys.has(defaultSelector ?? "") ? (defaultRole ?? "") : ""}
							extras={MODEL_EXTRAS}
							thinking
							onSelect={(v) => {
								if (v === "__custom") {
									setCustomOpen(true);
									return;
								}
								setCustomOpen(false);
								void modelSave.run(async () => {
									const nextRoles = withRoleAssignment(currentRoles, "default", v);
									await ompConfigSet("modelRoles", JSON.stringify(nextRoles));
									await loadOmp(true);
									if (settings?.newSessionModel) {
										await save({ newSessionModel: null });
									}
									toast.success("已更新全局主力模型");
								});
							}}
						/>
					}
				>
					{showCustom && (
						<CommitInput
							mono
							aria-label="手动输入全局默认模型"
							placeholder="例如 google-antigravity/gemini-3.8-flash:high"
							value={defaultRole ?? ""}
							validate={(v) => (v.startsWith("-") ? "模型名不能以 '-' 开头" : null)}
							onCommit={async (v) => {
								const val = v.trim() || null;
								const nextRoles = withRoleAssignment(currentRoles, "default", val);
								await ompConfigSet("modelRoles", JSON.stringify(nextRoles));
								await loadOmp(true);
								if (settings?.newSessionModel) {
									await save({ newSessionModel: null });
								}
								setCustomOpen(false);
								toast.success("已更新全局主力模型");
							}}
						/>
					)}
				</SettingRow>

				<SettingRow
					fieldId="defaultApprovalMode"
					label="审批模式 (Approval Mode)"
					description={currentApprovalOption.desc}
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
										<span className="inline-flex items-center gap-1 text-amber-400">
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
			</SettingsCard>

			<SettingsCard title="界面与快捷键">
				<ToggleRow
					fieldId="capsuleVisible"
					label="顶部子任务胶囊"
					description="当前会话派生并发子任务（Subagent）时，在窗口顶部栏显示胶囊指示器，点击可查看各子任务进度与详情。"
					checked={settings?.capsuleVisible ?? true}
					onChange={(v) => save({ capsuleVisible: v })}
				/>
				<ToggleRow
					fieldId="smartContextRouting"
					label="自动关联项目"
					description="新开对话时自动识别你在做哪个项目，并把最近的相关工作告诉 AI。"
					checked={settings?.smartContextRouting ?? true}
					onChange={(v) => save({ smartContextRouting: v })}
				/>
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

			<SettingsCard title="Git 与代码交付">
				<SettingRow
					fieldId="gitDeliveryMode"
					label="主干交付模式"
					description="从功能分支交付到 main 主干时的默认行为方式。"
					hint="默认推荐使用 Pull Request，经网页审查后再合流"
					control={
						<Segmented
							value={(settings?.gitDeliveryMode as "pr" | "direct") ?? "pr"}
							onChange={(v) => void save({ gitDeliveryMode: v })}
							options={[
								{
									value: "pr",
									label: "GitHub Pull Request (推荐)",
									title: "推送到云端同名分支并自动打开 GitHub 网页发起 PR 评审",
								},
								{
									value: "direct",
									label: "本地直接合并入 main 并直推",
									title: "本地合并入 main 后直接推送到云端 origin/main（适合个人单人极速开发）",
								},
							]}
						/>
					}
				/>
			</SettingsCard>

			<SettingsCard title="长期规则">
				<SettingRow
					fieldId="agentsMdShortcut"
					label="AGENTS.md（给 AI 的长期指令）"
					description="写下希望 AI 每次都遵守的习惯与约定，例如代码风格、回复语言。"
					control={
						<button type="button" onClick={() => navigate("agents-md")} className={SETTINGS_BUTTON_CLASS}>
							<span>编辑</span>
							<ChevronRight className="h-3.5 w-3.5" />
						</button>
					}
				/>
			</SettingsCard>
		</div>
	);
}
