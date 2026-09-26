import {
	ArrowLeft,
	Bell,
	Bot,
	Download,
	FileDown,
	FileUp,
	FolderOpen,
	KeyRound,
	Palette,
	RefreshCw,
	RotateCcw,
	Settings as SettingsIcon,
	Settings2,
	Sliders,
	Smartphone,
	Sparkles,
	Volume2,
	VolumeX,
	Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Settings } from "../../lib/contracts";
import { FONT_SIZES, UI_SCALES, setFontSize, setUiScale, useFontSize, useUiScale } from "../../lib/theme";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	appPaths,
	installStatusExtensionGlobally,
	notifyTest,
	readTextFile,
	writeTextFile,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { ThemePicker } from "../../components/ThemePicker";
import { MobilePanel } from "../mobile/MobilePanel";
import { DEFAULT_SETTINGS, useSettings } from "./store";
import { OmpConfigSection } from "./OmpConfigSection";
import { ProviderPanel } from "../providers/ProviderPanel";

interface ToggleProps {
	checked: boolean;
	onChange: (next: boolean) => void;
	label: string;
	description?: string;
	icon?: React.ComponentType<{ className?: string }>;
}

function Toggle({ checked, onChange, label, description, icon: Icon }: ToggleProps) {
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onChange(!checked)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onChange(!checked);
				}
			}}
			className="group flex cursor-pointer items-center justify-between gap-4 rounded-lg p-2 -m-2 transition-colors hover:bg-neutral-800/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500"
		>
			<div className="flex items-start gap-2.5">
				{Icon && (
					<div className="mt-0.5 text-neutral-400 group-hover:text-neutral-200">
						<Icon className="h-4 w-4" />
					</div>
				)}
				<div>
					<div className="text-xs font-medium text-neutral-200 group-hover:text-neutral-100">
						{label}
					</div>
					{description && (
						<div className="text-[11px] text-neutral-500">{description}</div>
					)}
				</div>
			</div>
			<div
				className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
					checked ? "bg-amber-500" : "bg-neutral-700"
				}`}
			>
				<span
					className={`inline-block h-3.5 w-3.5 transform rounded-full bg-neutral-950 transition duration-200 ease-in-out ${
						checked ? "translate-x-4.5" : "translate-x-1"
					}`}
				/>
			</div>
		</div>
	);
}
export function SettingsPage() {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const updateSettings = useSettings((s) => s.update);
	const storeError = useSettings((s) => s.error);

	const [testingNotify, setTestingNotify] = useState(false);
	const [notifySuccess, setNotifySuccess] = useState(false);
	const [installingExt, setInstallingExt] = useState(false);
	const [extInstallResult, setExtInstallResult] = useState<string | null>(null);
	const [activeSection, setActiveSection] = useState<string>("general");
	const [saveNotice, setSaveNotice] = useState<string | null>(null);
	const pendingSection = useUi((s) => s.settingsSection);
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const setCenter = useUi((s) => s.setCenter);

	// When opened via "更多外观设置…", land on the requested section.
	useEffect(() => {
		if (pendingSection) {
			setActiveSection(pendingSection);
			useUi.setState({ settingsSection: null });
		}
	}, [pendingSection]);

	// Local buffer for text inputs to prevent keystroke IPC storms
	const [localSupervisorModel, setLocalSupervisorModel] = useState("");
	const [localIdleMinutes, setLocalIdleMinutes] = useState("0");
	const [localShortcut, setLocalShortcut] = useState("");
	const [localOmpBinary, setLocalOmpBinary] = useState("");
	const [localSupervisorInterval, setLocalSupervisorInterval] = useState("30");
	const [localNewSessionModel, setLocalNewSessionModel] = useState("");
	const [localQuietFrom, setLocalQuietFrom] = useState("");
	const [localQuietTo, setLocalQuietTo] = useState("");

	useEffect(() => {
		if (settings) {
			setLocalSupervisorModel(settings.supervisorModel);
			setLocalIdleMinutes(String(settings.idleSuspendMinutes));
			setLocalShortcut(settings.quickCaptureShortcut);
			setLocalOmpBinary(settings.ompBinary);
			setLocalSupervisorInterval(String(settings.supervisorIntervalMinutes));
			setLocalNewSessionModel(settings.newSessionModel ?? "");
			setLocalQuietFrom(settings.notifyQuietFrom ?? "");
			setLocalQuietTo(settings.notifyQuietTo ?? "");
		}
	}, [
		settings?.supervisorModel,
		settings?.idleSuspendMinutes,
		settings?.quickCaptureShortcut,
		settings?.ompBinary,
		settings?.supervisorIntervalMinutes,
		settings?.newSessionModel,
		settings?.notifyQuietFrom,
		settings?.notifyQuietTo,
	]);

	const handleBack = () => {
		if (selectedSessionId) {
			selectSession(selectedSessionId);
		} else {
			setCenter("home");
		}
	};

	useEscapeKey(handleBack);


	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	const handleUpdate = async (patch: Partial<Settings>) => {
		if (patch.supervisorModel !== undefined && !patch.supervisorModel.trim()) {
			toast.error("监工模型不能为空");
			return;
		}
		if (patch.ompBinary !== undefined && !patch.ompBinary.trim()) {
			toast.error("OMP 命令行程序不能为空");
			return;
		}
		try {
			await updateSettings(patch);
			setSaveNotice("设置已自动保存");
			setTimeout(() => setSaveNotice(null), 2000);
		} catch (err) {
			const msg = errMsg(err);
			toast.error(`保存失败: ${msg}`);
		}
	};

	const commitSupervisorModel = async () => {
		if (!settings) return;
		const val = localSupervisorModel.trim();
		if (!val) {
			toast.error("监工模型不能为空");
			setLocalSupervisorModel(settings.supervisorModel);
			return;
		}
		if (val !== settings.supervisorModel) {
			await handleUpdate({ supervisorModel: val });
		}
	};

	const commitIdleMinutes = async () => {
		if (!settings) return;
		const parsed = Math.max(0, parseInt(localIdleMinutes, 10) || 0);
		setLocalIdleMinutes(String(parsed));
		if (parsed !== settings.idleSuspendMinutes) {
			await handleUpdate({ idleSuspendMinutes: parsed });
		}
	};

	const commitShortcut = async () => {
		if (!settings) return;
		const val = localShortcut.trim();
		if (val && val !== settings.quickCaptureShortcut) {
			await handleUpdate({ quickCaptureShortcut: val });
		} else if (!val) {
			setLocalShortcut(settings.quickCaptureShortcut);
		}
	};

	const commitOmpBinary = async () => {
		if (!settings) return;
		const val = localOmpBinary.trim();
		if (!val) {
			toast.error("OMP 命令行程序不能为空");
			setLocalOmpBinary(settings.ompBinary);
			return;
		}
		if (val !== settings.ompBinary) {
			await handleUpdate({ ompBinary: val });
		}
	};

	const commitSupervisorInterval = async () => {
		if (!settings) return;
		const parsed = Math.max(0, parseInt(localSupervisorInterval, 10) || 0);
		setLocalSupervisorInterval(String(parsed));
		if (parsed !== settings.supervisorIntervalMinutes) {
			await handleUpdate({ supervisorIntervalMinutes: parsed });
		}
	};

	const commitNewSessionModel = async () => {
		if (!settings) return;
		const val = localNewSessionModel.trim();
		if (val.startsWith("-")) {
			toast.error("新会话默认模型不能以 '-' 开头");
			setLocalNewSessionModel(settings.newSessionModel ?? "");
			return;
		}
		if (val !== (settings.newSessionModel ?? "")) {
			await handleUpdate({ newSessionModel: val === "" ? null : val });
		}
	};

	/** Quiet hours must be committed as a pair (backend validation requires both). */
	const updateQuietHours = (from: string, to: string) => {
		const nextFrom = from || null;
		const nextTo = to || null;
		if ((nextFrom && !nextTo) || (!nextFrom && nextTo)) {
			toast.error("免打扰时段需要同时设置开始与结束时间");
			return;
		}
		if (nextFrom !== settings?.notifyQuietFrom || nextTo !== settings?.notifyQuietTo) {
			void handleUpdate({ notifyQuietFrom: nextFrom, notifyQuietTo: nextTo });
		}
	};

	const commitQuietHours = () => {
		updateQuietHours(localQuietFrom, localQuietTo);
	};

	const clearQuietHours = () => {
		setLocalQuietFrom("");
		setLocalQuietTo("");
		updateQuietHours("", "");
	};

	const handleOpenDataDir = async () => {
		try {
			const paths = await appPaths();
			await revealItemInDir(paths.dataDir);
		} catch (err) {
			toast.error(`打开数据目录失败: ${errMsg(err)}`);
		}
	};

	const handleExportSettings = async () => {
		if (!settings) return;
		try {
			const path = await saveDialog({
				defaultPath: "omp-workspace-settings.json",
				filters: [{ name: "JSON", extensions: ["json"] }],
			});
			if (!path) return;
			await writeTextFile(path, JSON.stringify(settings, null, "\t"));
			toast.success("设置已导出");
		} catch (err) {
			toast.error(`导出失败: ${errMsg(err)}`);
		}
	};

	const handleImportSettings = async () => {
		try {
			const path = await openDialog({
				multiple: false,
				directory: false,
				filters: [{ name: "JSON", extensions: ["json"] }],
			});
			if (!path || Array.isArray(path)) return;
			const parsed = JSON.parse(await readTextFile(path)) as unknown;
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				toast.error("设置文件格式不正确（需要 JSON 对象）");
				return;
			}
			await handleUpdate(parsed as Partial<Settings>);
			toast.success("设置已导入");
		} catch (err) {
			toast.error(`导入失败: ${errMsg(err)}`);
		}
	};

	const handleResetSettings = async () => {
		const first = await confirmDialog("确定要将所有设置恢复为默认值吗？", {
			danger: true,
			okLabel: "恢复默认",
		});
		if (!first) return;
		const second = await confirmDialog(
			"再次确认：全部设置（含通知、监工、隧道等）都会被重置，且无法撤销。",
			{ danger: true, okLabel: "确认重置" },
		);
		if (!second) return;
		await handleUpdate(DEFAULT_SETTINGS);
		toast.success("已恢复默认设置");
	};

	const handleNotifyTest = async () => {
		setTestingNotify(true);
		setNotifySuccess(false);
		try {
			await notifyTest();
			setNotifySuccess(true);
			setTimeout(() => setNotifySuccess(false), 3000);
		} catch (err) {
			console.error("notify test failed", err);
		} finally {
			setTestingNotify(false);
		}
	};

	const handleInstallExtension = async () => {
		setInstallingExt(true);
		setExtInstallResult(null);
		try {
			const res = await installStatusExtensionGlobally();
			setExtInstallResult(res || "扩展已成功安装至 ~/.omp/agent/extensions/");
		} catch (err) {
			setExtInstallResult(`安装失败: ${String(err)}`);
		} finally {
			setInstallingExt(false);
		}
	};

	if (!settings) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-neutral-500">
				<RefreshCw className="mr-2 h-4 w-4 animate-spin" />
				<span>正在加载设置...</span>
			</div>
		);
	}

	const sections = [
		{ id: "general", label: "通用", icon: Sliders },
		{ id: "appearance", label: "外观", icon: Palette },
		{ id: "providers", label: "API 供应商", icon: KeyRound },
		{ id: "todos", label: "待办与监工", icon: Sparkles },
		{ id: "sessions", label: "会话", icon: Bot },
		{ id: "notifications", label: "通知", icon: Bell },
		{ id: "mobile", label: "手机访问", icon: Smartphone },
		{ id: "ompconfig", label: "OMP 配置", icon: Settings2 },
		{ id: "advanced", label: "高级", icon: Wrench },
	];

	return (
		<div className="flex h-full overflow-hidden bg-neutral-950 text-neutral-200">
			{/* Left Navigation Bar */}
			<div className="w-48 border-r border-neutral-800/80 bg-neutral-950/60 p-4">
				<button
					type="button"
					onClick={handleBack}
					className="mb-4 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
					title="返回工作区 (Esc)"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					<span>返回工作区</span>
				</button>
				<div className="mb-3 flex items-center gap-2 px-2 text-xs font-semibold text-neutral-400">
					<SettingsIcon className="h-4 w-4 text-amber-400" />
					<span>系统设置</span>
				</div>
				<nav className="space-y-1">
					{sections.map((sec) => {
						const Icon = sec.icon;
						const isActive = activeSection === sec.id;
						return (
							<button
								key={sec.id}
								type="button"
								onClick={() => setActiveSection(sec.id)}
								className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
									isActive
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
								}`}
							>
								<Icon className="h-3.5 w-3.5" />
								<span>{sec.label}</span>
							</button>
						);
					})}
				</nav>
			</div>

			{/* Main Settings Content Area */}
			<div className="flex-1 overflow-y-auto p-8">
				<div className="max-w-2xl space-y-8">
					{/* Status feedback alerts */}
					{storeError && (
						<div className="rounded-xl border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">
							保存失败: {storeError}
						</div>
					)}
					{saveNotice && (
						<div className="fixed bottom-6 right-6 z-50 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-emerald-400 shadow-xl">
							{saveNotice}
						</div>
					)}

					{/* 1. General Section */}
					{activeSection === "general" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">通用设置</h2>
								<p className="text-xs text-neutral-500">workbench 界面与行为配置</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<Toggle
									label="顶部胶囊 (Top Capsule)"
									description="在窗口右上角显示待处理待办统计与当前会话子任务状态条"
									checked={settings.capsuleVisible}
									onChange={(v) => handleUpdate({ capsuleVisible: v })}
								/>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="智能上下文路由"
										description="根据任务类型与历史自动推荐或选择合适模型及参考文件"
										checked={settings.smartContextRouting}
										onChange={(v) => handleUpdate({ smartContextRouting: v })}
									/>
								</div>
							</div>
						</div>
					)}

					{/* 2. Appearance */}
					{activeSection === "appearance" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">外观</h2>
								<p className="text-xs text-neutral-500">主题、聊天字号与界面密度</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<div>
									<div className="text-xs font-medium text-neutral-200">主题</div>
									<div className="mt-1 text-[11px] text-neutral-500">
										默认跟随系统明暗自动切换；也可固定深色或浅色主题
									</div>
									<div className="mt-3">
										<ThemePicker />
									</div>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<div className="text-xs font-medium text-neutral-200">聊天字号</div>
									<div className="mt-1 text-[11px] text-neutral-500">
										会话消息正文的文字大小
									</div>
									<div className="mt-2 inline-flex rounded-lg border border-neutral-700 p-0.5">
										{FONT_SIZES.map((f) => {
											const active = fontSize === f.id;
											return (
												<button
													key={f.id}
													type="button"
													onClick={() => setFontSize(f.id)}
													className={`rounded-md px-3 py-1 text-xs transition-colors ${
														active
															? "bg-neutral-800 text-neutral-100"
															: "text-neutral-400 hover:text-neutral-200"
													}`}
												>
													{f.name}
												</button>
											);
										})}
									</div>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<div className="text-xs font-medium text-neutral-200">界面密度</div>
									<div className="mt-1 text-[11px] text-neutral-500">
										整体界面的缩放程度
									</div>
									<div className="mt-2 inline-flex rounded-lg border border-neutral-700 p-0.5">
										{UI_SCALES.map((s) => {
											const active = uiScale === s.id;
											return (
												<button
													key={s.id}
													type="button"
													onClick={() => setUiScale(s.id)}
													className={`rounded-md px-3 py-1 text-xs transition-colors ${
														active
															? "bg-neutral-800 text-neutral-100"
															: "text-neutral-400 hover:text-neutral-200"
													}`}
												>
													{s.name}
												</button>
											);
										})}
									</div>
								</div>
							</div>
						</div>
					)}

					{/* API providers (renders providers ProviderPanel) */}
					{activeSection === "providers" && <ProviderPanel />}

					{/* 2. Todos & Supervisor */}
					{activeSection === "todos" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">待办与监工</h2>
								<p className="text-xs text-neutral-500">
									自动化检测与只读 LLM 监工建议系统
								</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<Toggle
									label="系统待办检测"
									description="自动捕获会话审批、提问、报错、中断与待验收事件加入待办队列"
									checked={settings.systemDetection}
									onChange={(v) => handleUpdate({ systemDetection: v })}
								/>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="后台监工建议 (Supervisor)"
										description="定期基于会话摘要与收集箱生成建议（只读，无执行权限）"
										checked={settings.supervisorEnabled}
										onChange={(v) => handleUpdate({ supervisorEnabled: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										监工模型
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										监工调用 omp -p 时指定的轻量模型，建议保持快速或低成本模型
									</div>
									<input
										type="text"
										value={localSupervisorModel}
										onChange={(e) => setLocalSupervisorModel(e.target.value)}
										onBlur={commitSupervisorModel}
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										placeholder="例如: smol, default"
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										监工触发间隔 (分钟)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										状态变化后触发监工分析的去抖间隔，最短 5 分钟；0 表示仅手动刷新
									</div>
									<input
										type="number"
										min={0}
										max={10080}
										value={localSupervisorInterval}
										onChange={(e) => setLocalSupervisorInterval(e.target.value)}
										onBlur={commitSupervisorInterval}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="默认展开已处理待办"
										description="待办队列默认显示已完成的待办，无需手动展开"
										checked={settings.homeShowCompletedTodos}
										onChange={(v) => handleUpdate({ homeShowCompletedTodos: v })}
									/>
								</div>
							</div>
						</div>
					)}

					{/* 3. Sessions */}
					{activeSection === "sessions" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">会话管理</h2>
								<p className="text-xs text-neutral-500">会话生命周期与默认选项</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<div>
									<label className="block text-xs font-medium text-neutral-200">
										默认审批模式 (Approval Mode)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										启动新会话时的默认审批强度
									</div>
									<select
										value={settings.defaultApprovalMode}
										onChange={(e) =>
											handleUpdate({ defaultApprovalMode: e.target.value })
										}
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
									>
										<option value="always-ask">每步必问 (always-ask)</option>
										<option value="write">写操作审批 (write)</option>
										<option value="yolo">完全自动执行 (yolo)</option>
									</select>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										空闲挂起时长 (分钟)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										会话空闲超过此时长将自动挂起后台 RPC 进程以节约内存；0 表示从不挂起
									</div>
									<input
										type="number"
										min={0}
										max={1440}
										value={localIdleMinutes}
										onChange={(e) => setLocalIdleMinutes(e.target.value)}
										onBlur={commitIdleMinutes}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="自动刷新会话摘要"
										description="后台定期基于最近会话内容更新摘要；关闭后仅手动刷新"
										checked={settings.sessionTurnAutoRefresh}
										onChange={(v) => handleUpdate({ sessionTurnAutoRefresh: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										新会话默认模型
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										启动新会话时使用的默认模型（留空跟随 omp 自身配置；当前版本暂未接入新会话流程）
									</div>
									<input
										type="text"
										value={localNewSessionModel}
										onChange={(e) => setLocalNewSessionModel(e.target.value)}
										onBlur={commitNewSessionModel}
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										placeholder="例如: gpt-5.6-sol"
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
									/>
								</div>
							</div>
						</div>
					)}

					{/* 4. Notifications */}
					{activeSection === "notifications" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">通知提醒</h2>
								<p className="text-xs text-neutral-500">
									系统原生通知、Dock 角标与提示音设置
								</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<Toggle
									label="轮次结束通知"
									description="Agent 完成本轮思考并等待验收时触发系统通知"
									checked={settings.notifyTurnEnd}
									onChange={(v) => handleUpdate({ notifyTurnEnd: v })}
								/>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="审批与提问通知"
										description="Agent 请求危险工具审批或需要用户输入回答时通知"
										checked={settings.notifyApproval}
										onChange={(v) => handleUpdate({ notifyApproval: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="异常与中断通知"
										description="会话因报错退出或进程意外终止时通知"
										checked={settings.notifyExit}
										onChange={(v) => handleUpdate({ notifyExit: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="通知提示音"
										description="发送通知时伴随系统默认提示音"
										icon={settings.notifySound ? Volume2 : VolumeX}
										checked={settings.notifySound}
										onChange={(v) => handleUpdate({ notifySound: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<Toggle
										label="Dock 角标"
										description="在程序坞图标上显示待处理的待办数量"
										checked={settings.dockBadgeEnabled}
										onChange={(v) => handleUpdate({ dockBadgeEnabled: v })}
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										免打扰时段
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										该时段内不发送系统通知（可跨零点，如 23:00 至次日 07:30）；开始与结束需同时设置
									</div>
									<div className="mt-2 flex items-center gap-2">
										<input
											type="time"
											value={localQuietFrom}
											onChange={(e) => setLocalQuietFrom(e.target.value)}
											onBlur={commitQuietHours}
											className="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
										/>
										<span className="text-xs text-neutral-500">至</span>
										<input
											type="time"
											value={localQuietTo}
											onChange={(e) => setLocalQuietTo(e.target.value)}
											onBlur={commitQuietHours}
											className="rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
										/>
										{(settings.notifyQuietFrom || settings.notifyQuietTo) && (
											<button
												type="button"
												onClick={clearQuietHours}
												className="rounded-lg px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200"
											>
												关闭免打扰
											</button>
										)}
									</div>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<span className="text-xs text-neutral-400">
										测试系统通知权限与提示音
									</span>
									<button
										type="button"
										disabled={testingNotify}
										onClick={handleNotifyTest}
										className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
									>
										<Bell className="h-3.5 w-3.5" />
										<span>{testingNotify ? "正在发送..." : "发送测试通知"}</span>
									</button>
								</div>
								{notifySuccess && (
									<div className="text-right text-[11px] text-emerald-400">
										✓ 测试通知已触发
									</div>
								)}
							</div>
						</div>
					)}

					{/* 5. Mobile Access (renders E MobilePanel) */}
					{activeSection === "mobile" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">手机访问</h2>
								<p className="text-xs text-neutral-500">
									通过局域网或 Cloudflare Tunnel 在手机移动端实时查看与审批待办
								</p>
							</div>

							<div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<MobilePanel />
							</div>
						</div>
					)}

					{/* 5.5 OMP config bridge (`omp config list/set/reset`) */}
					{activeSection === "ompconfig" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">OMP 配置</h2>
								<p className="text-xs text-neutral-500">
									读写 omp 自身的全局配置（~/.omp/agent/config.yml），与 workbench 设置相互独立
								</p>
							</div>
							<OmpConfigSection />
						</div>
					)}

					{/* 6. Advanced */}
					{activeSection === "advanced" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold text-neutral-100">高级配置</h2>
								<p className="text-xs text-neutral-500">命令行可执行路径与状态扩展</p>
							</div>

							<div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
								<div>
									<label className="block text-xs font-medium text-neutral-200">
										全局快捷键 (快速捕获)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										呼出快速收集弹窗的全局快捷键，默认 CommandOrControl+Shift+I
									</div>
									<input
										type="text"
										value={localShortcut}
										onChange={(e) => setLocalShortcut(e.target.value)}
										onBlur={commitShortcut}
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 font-mono focus:border-amber-500 focus:outline-none"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										OMP 命令行程序 (omp binary)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										用于启动会话、监工与摘要生成的二进制名称或完整绝对路径
									</div>
									<input
										type="text"
										value={localOmpBinary}
										onChange={(e) => setLocalOmpBinary(e.target.value)}
										onBlur={commitOmpBinary}
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 font-mono focus:border-amber-500 focus:outline-none"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											安装全局状态扩展
										</div>
										<div className="text-[11px] text-neutral-500">
											将状态追踪扩展安装至 ~/.omp/agent/extensions/，让外部终端运行的 omp 会话也出现在工作台
										</div>
									</div>
									<button
										type="button"
										disabled={installingExt}
										onClick={handleInstallExtension}
										className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
									>
										<Download className="h-3.5 w-3.5" />
										<span>{installingExt ? "正在安装..." : "安装全局扩展"}</span>
									</button>
								</div>
								{extInstallResult && (
									<div className="rounded-lg bg-neutral-950 p-2 text-[11px] font-mono text-neutral-300">
										{extInstallResult}
									</div>
								)}

								<div className="border-t border-neutral-800/60 pt-4">
									<div className="text-xs font-medium text-neutral-200">数据管理</div>
									<div className="mt-1 text-[11px] text-neutral-500">
										打开数据目录、导出或导入设置 JSON，或将全部设置恢复为默认值
									</div>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<button
											type="button"
											onClick={handleOpenDataDir}
											className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
										>
											<FolderOpen className="h-3.5 w-3.5" />
											<span>打开数据目录</span>
										</button>
										<button
											type="button"
											onClick={handleExportSettings}
											className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
										>
											<FileDown className="h-3.5 w-3.5" />
											<span>导出设置</span>
										</button>
										<button
											type="button"
											onClick={handleImportSettings}
											className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
										>
											<FileUp className="h-3.5 w-3.5" />
											<span>导入设置</span>
										</button>
										<button
											type="button"
											onClick={handleResetSettings}
											className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/60"
										>
											<RotateCcw className="h-3.5 w-3.5" />
											<span>恢复默认设置</span>
										</button>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
