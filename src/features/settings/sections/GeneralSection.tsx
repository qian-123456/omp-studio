/**
 * Settings ▸ 通用 (`general`): the handful of things most users change —
 * omp environment, what a new chat starts with, UI/shortcut, AGENTS.md entry.
 */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, CheckCircle2, ChevronRight, FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ModelSelect, type ModelExtraOption } from "../../../components/ModelSelect";
import { Segmented } from "../../../components/Segmented";
import { errMsg } from "../../../lib/dialogs";
import type { OmpInfo } from "../../../lib/contracts";
import { ompConfigSet, ompInfo } from "../../../lib/ipc";
import { toModelKey } from "../../../lib/models";
import { toast } from "../../../lib/toast";
import { THINKING_SUFFIXES, asRecord, roleValue } from "../modelRoles";
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

const NEW_SESSION_EXTRAS: ModelExtraOption[] = [
	{ value: "", label: "不指定（交给 omp 决定）", hint: "推荐" },
	{ value: "default", label: "主力模型 (default)", hint: "omp 角色" },
	{ value: "smol", label: "快速模型 (smol)", hint: "omp 角色" },
	{ value: "__custom", label: "手动输入模型…", hint: "自定义" },
];

type ApprovalMode = "always-ask" | "write" | "yolo";

const APPROVAL_OPTIONS: { value: ApprovalMode; label: string; detail: string }[] = [
	{ value: "always-ask", label: "每步都问", detail: "AI 每次执行命令或改文件前都先问你，最稳妥但需要你一直盯着。" },
	{ value: "write", label: "改动前问", detail: "读文件、搜索等只读操作自动进行；改文件、跑命令前先问你。推荐。" },
	{ value: "yolo", label: "全自动", detail: "不再询问，AI 直接改文件、执行命令。速度快，但误操作不会被拦下，有风险。" },
];

/** Chinese labels for omp thinking levels (schema enum `defaultThinkingLevel`). */
const THINKING_LABELS: Record<string, string> = {
	auto: "自动",
	minimal: "最少",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "很高",
	max: "最大",
};

export function GeneralSection() {
	const { settings, save } = useAppSettings();
	const { models, catalogKeys } = useModelCatalog();
	const { navigate } = useSettingsNav();
	const approvalSave = useSaveStatus();
	const modelSave = useSaveStatus();
	const thinkingSave = useSaveStatus();
	const shortcutSave = useSaveStatus();
	const [customOpen, setCustomOpen] = useState(false);

	const ompEntries = useOmpConfigStore((s) => s.entries);
	const ompLoading = useOmpConfigStore((s) => s.loading);
	const ompError = useOmpConfigStore((s) => s.error);
	const loadOmp = useOmpConfigStore((s) => s.load);

	const [info, setInfo] = useState<OmpInfo | null>(null);
	const [infoLoading, setInfoLoading] = useState(false);

	const refreshInfo = useCallback(async () => {
		setInfoLoading(true);
		try {
			setInfo(await ompInfo());
		} catch (e) {
			toast.error(`检测 omp 失败: ${errMsg(e)}`);
		} finally {
			setInfoLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadOmp();
	}, [loadOmp]);

	// Re-probe whenever the configured binary changes (also covers first load).
	const ompBinary = settings?.ompBinary;
	useEffect(() => {
		if (ompBinary !== undefined) void refreshInfo();
	}, [ompBinary, refreshInfo]);

	const reveal = async (path: string, what: string) => {
		try {
			await revealItemInDir(path);
		} catch (e) {
			toast.error(`在访达中显示${what}失败: ${errMsg(e)}`);
		}
	};

	const reloadOmp = async () => {
		await Promise.all([loadOmp(true), refreshInfo()]);
		const err = useOmpConfigStore.getState().error;
		if (err) toast.error(`读取 OMP 配置失败: ${err}`);
		else toast.success("已重新读取 OMP 配置");
	};

	// ── new-session model ──
	const current = settings?.newSessionModel ?? "";
	const modelLabel = !current
		? "不指定（交给 omp 决定）"
		: current === "default"
			? "主力模型 (default)"
			: current === "smol"
				? "快速模型 (smol)"
				: (models.find((m) => toModelKey(m.provider, m.id) === current)?.name ?? current);
	const showCustom =
		customOpen || (Boolean(current) && !catalogKeys.has(current) && !["default", "smol"].includes(current));

	const thinkingEntry = ompEntries.find((e) => e.key === "defaultThinkingLevel");
	const thinking = typeof thinkingEntry?.value === "string" ? thinkingEntry.value : "auto";
	const defaultRole = roleValue(asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value), "default");

	const approval = (settings?.defaultApprovalMode ?? "write") as ApprovalMode;
	const approvalDetail = APPROVAL_OPTIONS.find((o) => o.value === approval)?.detail;

	const ompStatus = infoLoading && !info ? (
		<span className="inline-flex items-center gap-1 text-neutral-400">
			<Loader2 className="h-3 w-3 animate-spin" /> 正在检测…
		</span>
	) : info?.found ? (
		<span className="inline-flex items-center gap-1 text-emerald-400">
			<CheckCircle2 className="h-3 w-3" />
			已找到 {info.version ?? "（版本未知）"}
			<span className="font-mono text-neutral-500">· {info.resolvedPath}</span>
		</span>
	) : info ? (
		<span className="inline-flex items-center gap-1 text-amber-400">
			<AlertTriangle className="h-3 w-3" />
			找不到这个程序，会话将无法启动。请填写 omp 的完整路径（终端运行 <code>which omp</code> 可查看）。
		</span>
	) : null;

	return (
		<div className="space-y-6">
			<SectionHeader title="通用" description="最常改的几项：用哪个 omp、新对话怎么开始、界面与快捷键" />

			<SettingsCard title="OMP 环境">
				<SettingRow
					fieldId="ompBinary"
					stacked
					label="omp 程序位置"
					description="本应用通过这个命令启动 AI 会话。一般填 omp 即可；装在非常规位置时填完整路径。"
					hint={ompStatus}
					control={
						<CommitInput
							mono
							aria-label="omp 程序位置"
							placeholder="omp"
							value={settings?.ompBinary ?? ""}
							validate={(v) => (v ? null : "omp 程序位置不能为空")}
							onCommit={(v) => save({ ompBinary: v })}
						/>
					}
				/>
				<SettingRow
					fieldId="ompConfigFiles"
					stacked
					label="omp 配置文件"
					description="omp 自己的设置保存在这里；在终端里用 omp 时也会读取同一份。"
					hint={
						<>
							{info ? <span className="font-mono">{info.configPath}</span> : null}
							{info && !info.configExists ? "（尚未创建，改过任意 omp 设置后生成）" : null}
							{ompError ? <span className="text-amber-400"> 读取失败：{ompError}</span> : null}
						</>
					}
					control={
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								disabled={!info?.configExists}
								onClick={() => info && void reveal(info.configPath, "配置文件")}
								className={SETTINGS_BUTTON_CLASS}
							>
								<FileText className="h-3.5 w-3.5" />
								<span>在访达中显示 config.yml</span>
							</button>
							<button
								type="button"
								disabled={!info}
								onClick={() => info && void reveal(info.agentDir, "目录")}
								className={SETTINGS_BUTTON_CLASS}
							>
								<FolderOpen className="h-3.5 w-3.5" />
								<span>打开 omp 数据目录</span>
							</button>
							<button
								type="button"
								disabled={ompLoading}
								onClick={() => void reloadOmp()}
								className={SETTINGS_BUTTON_CLASS}
								title="在外部改过 config.yml 后点这里，让设置页显示最新值"
							>
								<RefreshCw className={ompLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
								<span>重新读取 OMP 配置</span>
							</button>
						</div>
					}
				/>
			</SettingsCard>

			<SettingsCard title="新会话默认" footer="这三项决定「新开一个对话时」用什么模型、想多深、要不要先问你。只影响之后新开的对话。">
				<SettingRow
					fieldId="newSessionModel"
					label="默认模型"
					description="新对话一开始使用的模型；不指定时由 omp 的 default 角色决定。"
					status={modelSave.status}
					statusError={modelSave.error}
					control={
						<ModelSelect
							direction="down"
							widthClass="w-[360px]"
							label={modelLabel}
							buttonClass={MODEL_PICKER_BUTTON_CLASS}
							models={models}
							currentValue={catalogKeys.has(current) ? current : ""}
							extras={NEW_SESSION_EXTRAS}
							onSelect={(v) => {
								if (v === "__custom") {
									setCustomOpen(true);
									return;
								}
								setCustomOpen(false);
								void modelSave.run(() => save({ newSessionModel: v === "" ? null : v }));
							}}
						/>
					}
				>
					{showCustom && (
						<CommitInput
							mono
							aria-label="手动输入默认模型"
							placeholder="例如 anthropic/claude-sonnet-4-5"
							value={current}
							validate={(v) => (v.startsWith("-") ? "模型名不能以 '-' 开头" : null)}
							onCommit={(v) => save({ newSessionModel: v === "" ? null : v })}
						/>
					)}
					{!current && (
						<div className="flex items-center gap-2 text-[11px] text-neutral-500">
							<span>
								对话模型未指定时使用 omp 角色 default：
								<span className="font-mono text-neutral-300">{defaultRole ?? "omp 内置默认"}</span>
							</span>
							<button
								type="button"
								onClick={() => navigate("omp-roles")}
								className="inline-flex items-center text-[var(--accent)] hover:underline"
							>
								去模型角色修改
								<ChevronRight className="h-3 w-3" />
							</button>
						</div>
					)}
				</SettingRow>
				<SettingRow
					fieldId="newSessionThinkingLevel"
					stacked
					label="思考深度 (Thinking Level)"
					description="支持「思考」的模型在回答前推理多久。越深越慢、越费额度；自动 = 按问题难度决定。"
					hint={ompError && !thinkingEntry ? "读取不到 omp 配置，暂时无法修改" : undefined}
					status={thinkingSave.status}
					statusError={thinkingSave.error}
					control={
						<Segmented
							size="sm"
							value={thinking}
							disabled={!thinkingEntry}
							onChange={(v) =>
								void thinkingSave.run(async () => {
									await ompConfigSet("defaultThinkingLevel", v);
									await loadOmp(true);
								})
							}
							options={THINKING_SUFFIXES.map((v) => ({ value: v, label: THINKING_LABELS[v] ?? v, title: v }))}
						/>
					}
				/>
				<SettingRow
					fieldId="defaultApprovalMode"
					stacked
					label="审批模式 (Approval Mode)"
					description="AI 想改文件或执行命令时，要不要先征得你同意。"
					status={approvalSave.status}
					statusError={approvalSave.error}
					control={
						<Segmented
							value={approval}
							onChange={(v) => void approvalSave.run(() => save({ defaultApprovalMode: v }))}
							options={APPROVAL_OPTIONS.map((o) => ({
								value: o.value,
								title: o.detail,
								label:
									o.value === "yolo" ? (
										<span className="inline-flex items-center gap-1">
											<AlertTriangle className="h-3 w-3 text-amber-400" />
											{o.label}
										</span>
									) : (
										o.label
									),
							}))}
						/>
					}
				>
					{approvalDetail && (
						<div className={approval === "yolo" ? "text-[11px] text-amber-400" : "text-[11px] text-neutral-400"}>
							{approvalDetail}
						</div>
					)}
				</SettingRow>
			</SettingsCard>

			<SettingsCard title="界面与快捷键">
				<ToggleRow
					fieldId="capsuleVisible"
					label="顶部状态胶囊"
					description="窗口顶部显示一个小条，随时看到正在运行的对话和提醒。"
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

			<SettingsCard title="规则文件">
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
