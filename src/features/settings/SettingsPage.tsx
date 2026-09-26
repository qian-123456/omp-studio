import {
	Bell,
	Bot,
	Download,
	Monitor,
	Palette,
	RefreshCw,
	Settings as SettingsIcon,
	Sliders,
	Smartphone,
	Sparkles,
	Volume2,
	VolumeX,
	Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Settings } from "../../lib/contracts";
import {
	FONT_SIZES,
	THEMES,
	UI_SCALES,
	setFontSize,
	setTheme,
	setUiScale,
	useFontSize,
	useThemeChoice,
	useUiScale,
	type ThemeChoice,
} from "../../lib/theme";
import { installStatusExtensionGlobally, notifyTest } from "../../lib/ipc";
import { MobilePanel } from "../mobile/MobilePanel";
import { useUi } from "../../stores/ui";
import { useSettings } from "./store";

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
	const themeChoice = useThemeChoice();
	const fontSize = useFontSize();
	const uiScale = useUiScale();

	// When opened via "更多外观设置…", land on the requested section.
	useEffect(() => {
		if (pendingSection) {
			setActiveSection(pendingSection);
			useUi.setState({ settingsSection: null });
		}
	}, [pendingSection]);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	const handleUpdate = async (patch: Partial<Settings>) => {
		try {
			await updateSettings(patch);
			setSaveNotice("设置已自动保存");
			setTimeout(() => setSaveNotice(null), 2000);
		} catch {
			// error handled in store
		}
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
		{ id: "todos", label: "待办与监工", icon: Sparkles },
		{ id: "sessions", label: "会话", icon: Bot },
		{ id: "notifications", label: "通知", icon: Bell },
		{ id: "mobile", label: "手机访问", icon: Smartphone },
		{ id: "advanced", label: "高级", icon: Wrench },
	];

	return (
		<div className="flex h-full overflow-hidden bg-neutral-950 text-neutral-200">
			{/* Left Navigation Bar */}
			<div className="w-48 border-r border-neutral-800/80 bg-neutral-950/60 p-4">
				<div className="mb-4 flex items-center gap-2 px-2 text-xs font-semibold text-neutral-400">
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
								<div className="flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											顶部胶囊 (Top Capsule)
										</div>
										<div className="text-[11px] text-neutral-500">
											在窗口右上角显示待处理待办统计与当前会话子任务状态条
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.capsuleVisible}
										onChange={(e) =>
											handleUpdate({ capsuleVisible: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											智能上下文路由
										</div>
										<div className="text-[11px] text-neutral-500">
											根据任务类型与历史自动推荐或选择合适模型及参考文件
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.smartContextRouting}
										onChange={(e) =>
											handleUpdate({ smartContextRouting: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
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
										选择界面配色；「跟随系统」按系统明暗设置自动切换
									</div>
									<div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
										{THEMES.map((t) => {
											const active = themeChoice === t.id;
											return (
												<button
													key={t.id}
													type="button"
													onClick={() => setTheme(t.id as ThemeChoice)}
													className={`rounded-lg border p-2 text-left transition-colors ${
														active
															? "border-amber-500"
															: "border-neutral-700/60 hover:border-neutral-600"
													}`}
												>
													<span
														className="block h-10 w-full overflow-hidden rounded border border-black/20"
														style={{ backgroundColor: t.swatch.bg }}
														aria-hidden
													>
														<span
															className="mt-1 ml-1 block h-3 w-9 rounded-sm"
															style={{ backgroundColor: t.swatch.panel }}
														>
															<span
																className="mt-1 ml-1 block h-1.5 w-4 rounded-full"
																style={{ backgroundColor: t.swatch.accent }}
															/>
														</span>
													</span>
													<span className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-300">
														<span className="truncate">{t.name}</span>
														{active && (
															<span
																className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
																aria-hidden
															/>
														)}
													</span>
												</button>
											);
										})}
									</div>
									<button
										type="button"
										onClick={() => setTheme("system")}
										className={`mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
											themeChoice === "system"
												? "border-amber-500 text-neutral-100"
												: "border-neutral-700/60 text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
										}`}
									>
										<Monitor className="h-3.5 w-3.5" />
										<span>跟随系统</span>
									</button>
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
								<div className="flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											系统待办检测
										</div>
										<div className="text-[11px] text-neutral-500">
											自动捕获会话审批、提问、报错、中断与待验收事件加入待办队列
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.systemDetection}
										onChange={(e) =>
											handleUpdate({ systemDetection: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											后台监工建议 (Supervisor)
										</div>
										<div className="text-[11px] text-neutral-500">
											定期基于会话摘要与收集箱生成建议（只读，无执行权限）
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.supervisorEnabled}
										onChange={(e) =>
											handleUpdate({ supervisorEnabled: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-violet-500 focus:ring-0"
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
										value={settings.supervisorModel}
										onChange={(e) =>
											handleUpdate({ supervisorModel: e.target.value })
										}
										placeholder="例如: smol, default"
										className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
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
										<option value="write">写操作审批 (write - 默认)</option>
										<option value="read">读写审批 (read)</option>
										<option value="all">所有操作审批 (all)</option>
										<option value="never">完全自动执行 (never)</option>
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
										value={settings.idleSuspendMinutes}
										onChange={(e) =>
											handleUpdate({
												idleSuspendMinutes: Math.max(
													0,
													parseInt(e.target.value, 10) || 0,
												),
											})
										}
										className="mt-2 w-32 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-amber-500 focus:outline-none"
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
								<div className="flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											轮次结束通知
										</div>
										<div className="text-[11px] text-neutral-500">
											Agent 完成本轮思考并等待验收时触发系统通知
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.notifyTurnEnd}
										onChange={(e) =>
											handleUpdate({ notifyTurnEnd: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											审批与提问通知
										</div>
										<div className="text-[11px] text-neutral-500">
											Agent 请求危险工具审批或需要用户输入回答时通知
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.notifyApproval}
										onChange={(e) =>
											handleUpdate({ notifyApproval: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div>
										<div className="text-xs font-medium text-neutral-200">
											异常与中断通知
										</div>
										<div className="text-[11px] text-neutral-500">
											会话因报错退出或进程意外终止时通知
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.notifyExit}
										onChange={(e) =>
											handleUpdate({ notifyExit: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
								</div>

								<div className="border-t border-neutral-800/60 pt-4 flex items-center justify-between">
									<div className="flex items-center gap-2">
										{settings.notifySound ? (
											<Volume2 className="h-4 w-4 text-amber-400" />
										) : (
											<VolumeX className="h-4 w-4 text-neutral-500" />
										)}
										<div>
											<div className="text-xs font-medium text-neutral-200">
												通知提示音
											</div>
											<div className="text-[11px] text-neutral-500">
												发送通知时伴随系统默认提示音
											</div>
										</div>
									</div>
									<input
										type="checkbox"
										checked={settings.notifySound}
										onChange={(e) =>
											handleUpdate({ notifySound: e.target.checked })
										}
										className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
									/>
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
										value={settings.quickCaptureShortcut}
										onChange={(e) =>
											handleUpdate({ quickCaptureShortcut: e.target.value })
										}
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
										value={settings.ompBinary}
										onChange={(e) =>
											handleUpdate({ ompBinary: e.target.value })
										}
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
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
