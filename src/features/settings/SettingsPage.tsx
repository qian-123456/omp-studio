import {
	Bell,
	Bot,
	Brain,
	Download,
	FileDown,
	FileUp,
	FolderOpen,
	Globe,
	Hammer,
	History,
	KeyRound,
	Library,
	ListTree,
	Network,
	Palette,
	RefreshCw,
	RotateCcw,
	Search,
	Settings2,
	Sliders,
	Smartphone,
	Sparkles,
	Users,
	Volume2,
	VolumeX,
	Wrench,
	X,
	type LucideIcon,
} from "lucide-react";
import { NativeSelect } from "../../components/NativeSelect";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { ModelRolesSection } from "./ModelRolesSection";
import { CheckpointsSection } from "./CheckpointsSection";
import { Switch } from "./Switch";
import { useOmpConfigStore } from "./ompConfigStore";
import { OMP_DESKTOP_CATEGORIES, ompDesktopCategoryFor } from "./ompDesktopCategories";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { ProviderPanel } from "../providers/ProviderPanel";
import { useZoom } from "../../lib/zoom";

/** Nav icons for the OMP config category entries (`advanced` → OMP 其他). */
const OMP_CATEGORY_ICONS: Record<string, LucideIcon> = {
	model: ListTree,
	thinking: Brain,
	retry: RefreshCw,
	context: Library,
	tools: Hammer,
	tasks: Network,
	providers: Globe,
	advanced: Settings2,
};

/** Extra search terms for the app's own sections (nav-level search index). */
const SECTION_KEYWORDS: Record<string, string[]> = {
	general: ["缩放", "字体", "zoom", "font", "窗口"],
	appearance: ["主题", "深色", "浅色", "theme", "dark", "light", "字号"],
	providers: ["API", "密钥", "key", "provider", "anthropic", "openai", "凭证"],
	todos: ["待办", "监工", "todo", "supervisor", "巡检"],
	sessions: ["会话", "session", "新会话", "模型", "工作目录", "默认模型"],
	checkpoints: ["检查点", "checkpoint", "撤回", "对话", "存档", "规则"],
	notifications: ["通知", "提醒", "声音", "免打扰", "安静时段", "notify", "quiet"],
	mobile: ["手机", "移动端", "局域网", "配对", "二维码", "mobile", "lan"],
	advanced: ["OMP 命令行", "二进制", "binary", "导出", "导入", "重置", "数据目录", "扩展"],
};

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
			className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl p-2.5 -m-2 transition-colors hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]/40"
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
						<div className="text-[11px] text-[rgba(235,235,245,0.60)]">{description}</div>
					)}
				</div>
			</div>
			<Switch checked={checked} onChange={onChange} />
		</div>
	);
}
interface SettingsPageProps {
	onClose?: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps = {}) {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const updateSettings = useSettings((s) => s.update);
	const storeError = useSettings((s) => s.error);
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();
	const [testingNotify, setTestingNotify] = useState(false);
	const [notifySuccess, setNotifySuccess] = useState(false);
	const [installingExt, setInstallingExt] = useState(false);
	const [extInstallResult, setExtInstallResult] = useState<string | null>(null);
	const [activeSection, setActiveSection] = useState<string>("general");
	const contentRef = useRef<HTMLDivElement>(null);
	// Switching sections always lands at the top of the new section.
	useEffect(() => {
		contentRef.current?.scrollTo({ top: 0 });
	}, [activeSection]);

	// OMP config: the roles editor plus one entry per desktop category are
	// top-level nav items ("omp-*"); the category id is the section suffix.
	const ompCategory =
		activeSection.startsWith("omp-") && activeSection !== "omp-roles"
			? activeSection.slice("omp-".length)
			: null;
	const loadOmpConfig = useOmpConfigStore((s) => s.load);
	const ompEntries = useOmpConfigStore((s) => s.entries);
	const [navQuery, setNavQuery] = useState("");
	// Load OMP entries eagerly while searching so the nav index covers them.
	useEffect(() => {
		if (activeSection.startsWith("omp-") || navQuery.trim()) void loadOmpConfig();
	}, [activeSection, navQuery, loadOmpConfig]);
	const [saveNotice, setSaveNotice] = useState<string | null>(null);
	const pendingSection = useUi((s) => s.settingsSection);
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const closeSettings = useUi((s) => s.closeSettings);

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
		if (onClose) {
			onClose();
		} else {
			closeSettings();
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
			toast.error(`发送测试通知失败: ${errMsg(err)}`);
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

	// OMP config surfaces right after 通用: the roles editor plus one entry per
	// desktop category (the `advanced` bucket becomes "OMP 其他" so it never
	// clashes with the app's own 高级 section).
	const ompSections = [
		{ id: "omp-roles", label: "模型角色", icon: Users },
		...OMP_DESKTOP_CATEGORIES.map((c) => ({
			id: `omp-${c.id}`,
			label: c.id === "advanced" ? "OMP 其他" : c.label,
			icon: OMP_CATEGORY_ICONS[c.id] ?? Settings2,
		})),
	];
	const sections = [
		{ id: "general", label: "通用", icon: Sliders },
		...ompSections,
		{ id: "appearance", label: "外观", icon: Palette },
		{ id: "providers", label: "API 供应商", icon: KeyRound },
		{ id: "todos", label: "待办与监工", icon: Sparkles },
		{ id: "sessions", label: "会话", icon: Bot },
		{ id: "checkpoints", label: "对话检查点", icon: History },
		{ id: "notifications", label: "通知", icon: Bell },
		{ id: "mobile", label: "手机访问", icon: Smartphone },
		{ id: "advanced", label: "高级", icon: Wrench },
	];

	// Nav search index: section label + keywords + OMP keys/roles/custom terms.
	const navQueryL = navQuery.trim().toLowerCase();
	const navMatch = useMemo(() => {
		const sectionKeys = (id: string): string[] => {
			if (id === "omp-roles") {
				const cust = customRoles(
					asRecord(ompEntries.find((e) => e.key === "modelRoles")?.value),
				);
				return [
					...BUILTIN_ROLES.flatMap((r) => [r.id, r.zhLabel, r.description]),
					...cust,
					"modelroles",
					"fallback",
					"回退",
					"角色",
				];
			}
			const cat = OMP_DESKTOP_CATEGORIES.find((c) => `omp-${c.id}` === id);
			if (cat) {
				return ompEntries
					.filter((e) => ompDesktopCategoryFor(e.key).id === cat.id)
					.flatMap((e) => [
						e.key,
						ompConfigTitle(e.key),
						ompConfigDescription(e.key, e.description),
					]);
			}
			return SECTION_KEYWORDS[id] ?? [];
		};
		return sections
			.map((sec) => {
				const hits = navQueryL
					? sectionKeys(sec.id).filter((t) =>
							t.toLowerCase().includes(navQueryL),
						)
					: [];
				const hit =
					!navQueryL ||
					sec.label.toLowerCase().includes(navQueryL) ||
					hits.length > 0;
				return { ...sec, hit, hits: [...new Set(hits)] };
			})
			.filter((s) => s.hit);
	}, [navQueryL, ompEntries]);

	// Keep the active section inside the filtered set while searching.
	useEffect(() => {
		if (!navQueryL) return;
		if (!navMatch.some((s) => s.id === activeSection)) {
			setActiveSection(navMatch[0]?.id ?? activeSection);
		}
	}, [navMatch, navQueryL, activeSection]);

	return (
		<div className="flex h-full min-h-0 overflow-hidden bg-transparent text-neutral-200">
			{/* Left Navigation Bar */}
			<div className="flex w-48 shrink-0 flex-col overflow-hidden border-r border-[var(--border-divider)] vibrancy-chrome p-2.5">
				<div className="mb-2 flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1.5">
					<Search className="h-3 w-3 shrink-0 text-neutral-500" />
					<input
						value={navQuery}
						onChange={(e) => setNavQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape" && !isComposing(e)) {
								e.stopPropagation();
								if (navQuery) setNavQuery("");
								else e.currentTarget.blur();
							}
						}}
						placeholder="搜索设置…"
						className="w-full bg-transparent text-[11px] text-neutral-200 outline-none placeholder:text-neutral-500"
					/>
					{navQuery && (
						<button
							type="button"
							onClick={() => setNavQuery("")}
							className="shrink-0 rounded p-0.5 text-neutral-500 hover:text-neutral-300 active:scale-95 transition-all"
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</div>
				<nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
					{navMatch.length === 0 ? (
						<div className="px-2 py-3 text-center text-[11px] text-neutral-500">
							无匹配设置项
						</div>
					) : (
						navMatch.map((sec) => {
							const Icon = sec.icon;
							const isActive = activeSection === sec.id;
							const hint =
								sec.id.startsWith("omp-") && sec.hits.length > 0
									? sec.hits.slice(0, 2).join(" · ")
									: null;
							return (
								<button
									key={sec.id}
									type="button"
									onClick={() => setActiveSection(sec.id)}
									className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-all active:scale-[0.98] ${
										isActive
											? "bg-[var(--bg-hover)] text-neutral-100 shadow-sm"
											: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
									}`}
								>
									<Icon className="h-3.5 w-3.5" />
									<span className="min-w-0 flex-1 text-left">
										<span className="block truncate">{sec.label}</span>
										{hint && (
											<span className="block truncate text-[10px] font-normal text-neutral-500">
												{hint}
											</span>
										)}
									</span>
								</button>
							);
						})
					)}
				</nav>
			</div>


			{/* Main Settings Content Area */}
			<div ref={contentRef} className="flex-1 overflow-y-auto p-6 lg:p-7">
				<div className="max-w-2xl space-y-8">
					{/* Status feedback alerts */}
					{storeError && (
						<div className="rounded-xl border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">
							保存失败: {storeError}
						</div>
					)}
					{saveNotice && (
						<div className="fixed bottom-6 right-6 z-50 rounded-xl vibrancy-popover shadow-apple-modal hairline px-3.5 py-2 text-xs text-emerald-400">
							{saveNotice}
						</div>
					)}

					{/* 1. General Section */}
					{activeSection === "general" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">通用设置</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">workbench 界面与行为配置</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<Toggle
									label="顶部胶囊 (Top Capsule)"
									description="在窗口右上角显示待处理待办统计与当前会话子任务状态条"
									checked={settings.capsuleVisible}
									onChange={(v) => handleUpdate({ capsuleVisible: v })}
								/>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="智能上下文路由"
										description="侧边提问时根据问题意图自动切换仅选区上下文与完整会话上下文"
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
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">外观</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">主题、聊天字号与界面密度</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div>
									<div className="text-xs font-medium text-neutral-200">主题</div>
									<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
										默认跟随系统明暗自动切换；也可固定深色或浅色主题
									</div>
									<div className="mt-3">
										<ThemePicker />
									</div>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<div className="text-xs font-medium text-neutral-200">聊天字号</div>
									<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
										会话消息正文的文字大小
									</div>
									<div className="mt-2 inline-flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
										{FONT_SIZES.map((f) => {
											const active = fontSize === f.id;
											return (
												<button
													key={f.id}
													type="button"
													onClick={() => setFontSize(f.id)}
													className={`rounded-md px-3 py-1 text-xs transition-all active:scale-95 ${
														active
															? "bg-[var(--bg-active-fill)] text-neutral-100 shadow-sm font-medium"
															: "text-neutral-400 hover:text-neutral-200"
													}`}
												>
													{f.name}
												</button>
											);
										})}
									</div>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<div className="text-xs font-medium text-neutral-200">界面密度</div>
									<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
										整体界面的缩放程度
									</div>
									<div className="mt-2 inline-flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
										{UI_SCALES.map((s) => {
											const active = uiScale === s.id;
											return (
												<button
													key={s.id}
													type="button"
													onClick={() => setUiScale(s.id)}
													className={`rounded-md px-3 py-1 text-xs transition-all active:scale-95 ${
														active
															? "bg-[var(--bg-active-fill)] text-neutral-100 shadow-sm font-medium"
															: "text-neutral-400 hover:text-neutral-200"
													}`}
												>
													{s.name}
												</button>
											);
										})}
									</div>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<div className="flex items-center justify-between">
										<div>
											<div className="text-xs font-medium text-neutral-200">界面缩放</div>
											<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
												调节窗口视图比例（快捷键：Cmd/Ctrl +/-，重置：Cmd/Ctrl 0）
											</div>
										</div>
										<div className="flex items-center gap-1.5">
											<button
												type="button"
												onClick={zoomOut}
												disabled={zoom <= minZoom}
												title="缩小 (-5%)"
												className="rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all disabled:opacity-30"
											>
												-
											</button>
											<button
												type="button"
												onClick={resetZoom}
												title="重置为 100%"
												className="min-w-14 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-center font-mono tabular-nums text-xs text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
											>
												{zoom}%
											</button>
											<button
												type="button"
												onClick={zoomIn}
												disabled={zoom >= maxZoom}
												title="放大 (+5%)"
												className="rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all disabled:opacity-30"
											>
												+
											</button>
										</div>
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
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">待办与监工</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">
									自动化检测与只读 LLM 监工建议系统
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<Toggle
									label="系统待办检测"
									description="自动捕获会话审批、提问、报错、中断与待验收事件加入待办队列"
									checked={settings.systemDetection}
									onChange={(v) => handleUpdate({ systemDetection: v })}
								/>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="后台监工建议 (Supervisor)"
										description="定期基于会话摘要与收集箱生成建议（只读，无执行权限）"
										checked={settings.supervisorEnabled}
										onChange={(v) => handleUpdate({ supervisorEnabled: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										监工模型
									</label>
									<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
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
										className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										监工触发间隔 (分钟)
									</label>
									<div className="mt-1 text-[11px] text-[rgba(235,235,245,0.60)]">
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
										className="mt-2 w-32 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
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
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">会话管理</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">会话生命周期与默认选项</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div>
									<label className="block text-xs font-medium text-neutral-200">
										默认审批模式 (Approval Mode)
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										启动新会话时的默认审批强度
									</div>
									<NativeSelect
										value={settings.defaultApprovalMode}
										onChange={(e) =>
											handleUpdate({ defaultApprovalMode: e.target.value })
										}
										containerClassName="mt-2"
									>
										<option value="always-ask">每步必问 (always-ask)</option>
										<option value="write">写操作审批 (write)</option>
										<option value="yolo">完全自动执行 (yolo)</option>
									</NativeSelect>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
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
										className="mt-2 w-32 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="自动刷新会话摘要"
										description="后台定期基于最近会话内容更新摘要；关闭后仅手动刷新"
										checked={settings.sessionTurnAutoRefresh}
										onChange={(v) => handleUpdate({ sessionTurnAutoRefresh: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<label className="block text-xs font-medium text-neutral-200">
										新会话默认模型
									</label>
									<div className="mt-1 text-[11px] text-neutral-500">
										启动新会话时使用的默认模型（留空跟随 OMP 自身配置）
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
										className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>
							</div>
						</div>
					)}

					{/* 3.5 Turn checkpoints */}
					{activeSection === "checkpoints" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">对话检查点</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">
									每一轮对话自动保存现场，可随时撤回；仅限本应用启动的会话
								</p>
							</div>
							<CheckpointsSection />
						</div>
					)}

					{/* 4. Notifications */}
					{activeSection === "notifications" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">通知提醒</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">
									系统原生通知、Dock 角标与提示音设置
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<Toggle
									label="轮次结束通知"
									description="Agent 完成本轮思考并等待验收时触发系统通知"
									checked={settings.notifyTurnEnd}
									onChange={(v) => handleUpdate({ notifyTurnEnd: v })}
								/>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="审批与提问通知"
										description="Agent 请求危险工具审批或需要用户输入回答时通知"
										checked={settings.notifyApproval}
										onChange={(v) => handleUpdate({ notifyApproval: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="异常与中断通知"
										description="会话因报错退出或进程意外终止时通知"
										checked={settings.notifyExit}
										onChange={(v) => handleUpdate({ notifyExit: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="通知提示音"
										description="发送通知时伴随系统默认提示音"
										icon={settings.notifySound ? Volume2 : VolumeX}
										checked={settings.notifySound}
										onChange={(v) => handleUpdate({ notifySound: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
									<Toggle
										label="Dock 角标"
										description="在程序坞图标上显示待处理的待办数量"
										checked={settings.dockBadgeEnabled}
										onChange={(v) => handleUpdate({ dockBadgeEnabled: v })}
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
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
											className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
										/>
										<span className="text-xs text-neutral-500">至</span>
										<input
											type="time"
											value={localQuietTo}
											onChange={(e) => setLocalQuietTo(e.target.value)}
											onBlur={commitQuietHours}
											className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
										/>
										{(settings.notifyQuietFrom || settings.notifyQuietTo) && (
											<button
												type="button"
												onClick={clearQuietHours}
												className="rounded-lg px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
											>
												关闭免打扰
											</button>
										)}
									</div>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4 flex items-center justify-between">
									<span className="text-xs text-neutral-400">
										测试系统通知权限与提示音
									</span>
									<button
										type="button"
										disabled={testingNotify}
										onClick={handleNotifyTest}
										className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50"
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
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">手机访问</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">
									通过局域网或 Cloudflare Tunnel 在手机移动端实时查看与审批待办
								</p>
							</div>

							<div className="rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<MobilePanel />
							</div>
						</div>
					)}
					{/* 5.5 OMP config surfaces (roles editor + per-category flat list) */}
					{activeSection === "omp-roles" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">模型角色与回退链</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">
									为每类任务指定主力模型与回退顺序（对应 omp /model 的 Roles 视图），写入 ~/.omp/agent/config.yml
								</p>
							</div>
							<ModelRolesSection query={navQuery.trim()} />
						</div>
					)}
					{ompCategory !== null && (
						<OmpConfigSection
							activeTab={ompCategory}
							onTabChange={() => {}}
							activeGroupName={null}
							onGroupChange={() => {}}
							seedQuery={navQuery.trim()}
						/>
					)}

					{/* 6. Advanced */}
					{activeSection === "advanced" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">高级配置</h2>
								<p className="text-xs text-[rgba(235,235,245,0.60)]">命令行可执行路径与状态扩展</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
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
										className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 font-mono focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4">
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
										className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 font-mono focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div className="border-t border-[var(--border-divider)] pt-4 flex items-center justify-between">
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
										className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50"
									>
										<Download className="h-3.5 w-3.5" />
										<span>{installingExt ? "正在安装..." : "安装全局扩展"}</span>
									</button>
								</div>
								{extInstallResult && (
									<div className="rounded-lg bg-[var(--well-bg)] hairline p-2 text-[11px] font-mono text-neutral-300">
										{extInstallResult}
									</div>
								)}

								<div className="border-t border-[var(--border-divider)] pt-4">
									<div className="text-xs font-medium text-neutral-200">数据管理</div>
									<div className="mt-1 text-[11px] text-neutral-500">
										打开数据目录、导出或导入设置 JSON，或将全部设置恢复为默认值
									</div>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<button
											type="button"
											onClick={handleOpenDataDir}
											className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
										>
											<FolderOpen className="h-3.5 w-3.5" />
											<span>打开数据目录</span>
										</button>
										<button
											type="button"
											onClick={handleExportSettings}
											className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
										>
											<FileDown className="h-3.5 w-3.5" />
											<span>导出设置</span>
										</button>
										<button
											type="button"
											onClick={handleImportSettings}
											className="inline-flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
										>
											<FileUp className="h-3.5 w-3.5" />
											<span>导入设置</span>
										</button>
										<button
											type="button"
											onClick={handleResetSettings}
											className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800/40 bg-rose-950/20 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-950/40 active:scale-95 transition-all"
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
