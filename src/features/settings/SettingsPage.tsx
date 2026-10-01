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
	KeyRound,
	Library,
	ListTree,
	Network,
	Palette,
	Puzzle,
	RefreshCw,
	RotateCcw,
	Search,
	Server,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Model, Settings } from "../../lib/contracts";
import { FONT_SIZES, UI_SCALES, setFontSize, setUiScale, useFontSize, useUiScale } from "../../lib/theme";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	appPaths,
	installStatusExtensionGlobally,
	listModels,
	notifyTest,
	readTextFile,
	writeTextFile,
} from "../../lib/ipc";
import { toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { useSessions } from "../../stores/sessions";
import { ThemePicker } from "../../components/ThemePicker";
import { ModelSelect, type ModelExtraOption } from "../../components/ModelSelect";
import { NativeSelect } from "../../components/NativeSelect";
import { MobilePanel } from "../mobile/MobilePanel";
import { DEFAULT_SETTINGS, useSettings } from "./store";
import { OmpConfigSection } from "./OmpConfigSection";
import { ModelRolesSection } from "./ModelRolesSection";
import { CheckpointsSection } from "./CheckpointsSection";
import { Switch } from "./Switch";
import { useOmpConfigStore } from "./ompConfigStore";
import { ompDesktopCategoryFor } from "./ompDesktopCategories";
import { BUILTIN_ROLES, asRecord, customRoles } from "./modelRoles";
import { ompConfigDescription, ompConfigTitle } from "./ompConfigMeta";
import { ProviderPanel } from "../providers/ProviderPanel";
import { McpSection } from "./McpSection";
import { PluginsSection } from "./PluginsSection";
import { useZoom } from "../../lib/zoom";
import { validateSettingsShape } from "./validation";
import { FIELD_REGISTRY, findMatchingField, registryKeywordsForSection } from "./fieldRegistry";

interface NavItem {
	id: string;
	label: string;
	icon: LucideIcon;
}

interface NavGroup {
	title: string;
	items: NavItem[];
}

/** Information architecture: grouped navigation ordered by frequency of use. */
const NAV_GROUPS: NavGroup[] = [
	{
		title: "常规",
		items: [
			{ id: "general", label: "通用", icon: Sliders },
			{ id: "appearance", label: "外观", icon: Palette },
			{ id: "notifications", label: "通知", icon: Bell },
		],
	},
	{
		title: "模型",
		items: [
			{ id: "providers", label: "API 供应商", icon: KeyRound },
			{ id: "omp-roles", label: "模型角色", icon: Users },
			{ id: "omp-model", label: "模型与目录", icon: ListTree },
			{ id: "omp-thinking", label: "思考与采样", icon: Brain },
			{ id: "omp-retry", label: "重试与回退", icon: RefreshCw },
		],
	},
	{
		title: "Agent",
		items: [
			{ id: "sessions", label: "会话", icon: Bot },
			{ id: "inbox", label: "收件箱", icon: Sparkles },
			{ id: "omp-context", label: "上下文与记忆", icon: Library },
			{ id: "omp-tools", label: "工具与审批", icon: Hammer },
			{ id: "omp-tasks", label: "任务与子代理", icon: Network },
		],
	},
	{
		title: "连接",
		items: [
			{ id: "mobile", label: "手机访问", icon: Smartphone },
			{ id: "omp-providers", label: "网络与扩展", icon: Globe },
			{ id: "mcp", label: "MCP 服务器", icon: Server },
			{ id: "plugins", label: "插件", icon: Puzzle },
		],
	},
	{
		title: "高级",
		items: [
			{ id: "advanced", label: "高级", icon: Wrench },
			{ id: "omp-advanced", label: "其他 OMP 配置", icon: Settings2 },
		],
	},
];

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
						<div className="text-[11px] text-neutral-400">{description}</div>
					)}
				</div>
			</div>
			<Switch checked={checked} onChange={onChange} />
		</div>
	);
}

interface SettingsPageProps {
	onClose?: () => void;
	initialSection?: string;
}

export function SettingsPage({ onClose, initialSection }: SettingsPageProps = {}) {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const updateSettings = useSettings((s) => s.update);
	const storeError = useSettings((s) => s.error);
	const { zoom, zoomIn, zoomOut, resetZoom, minZoom, maxZoom } = useZoom();
	const [testingNotify, setTestingNotify] = useState(false);
	const [notifySuccess, setNotifySuccess] = useState(false);
	const [installingExt, setInstallingExt] = useState(false);
	const [extInstallResult, setExtInstallResult] = useState<string | null>(null);

	const [activeSection, setActiveSection] = useState<string>(initialSection ?? "general");
	// OMP category's schema sub-group filter (controlled into OmpConfigSection
	// so deep links can force it back to "all").
	const [ompGroupName, setOmpGroupName] = useState<string | null>(null);
	// Pending deep-link focus: scrolls the row into view and briefly flashes it.
	const [focusFlash, setFocusFlash] = useState<{ key: string; n: number } | null>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// Switching sections always lands at the top of the new section.
	useEffect(() => {
		contentRef.current?.scrollTo({ top: 0 });
		setOmpGroupName(null);
	}, [activeSection]);

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
	const pendingFocus = useUi((s) => s.settingsFocus);
	const fontSize = useFontSize();
	const uiScale = useUiScale();
	const closeSettings = useUi((s) => s.closeSettings);

	// Project scope follows the selected (or last viewed) session's cwd —
	// same rule as SkillsPage — for project mcp.json / plugin roots.
	const scopeSessionId = useUi((s) => s.selectedSessionId ?? s.lastSessionId);
	const projectCwd = useSessions((s) =>
		scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null,
	);

	// Jump to the section requested via openSettings(section, {focusKey}).
	useEffect(() => {
		if (!pendingSection && !pendingFocus) return;
		let target = pendingSection;
		const isOmpKey =
			pendingFocus &&
			target?.startsWith("omp-") &&
			!FIELD_REGISTRY.some((f) => f.id === pendingFocus);
		if (pendingFocus && isOmpKey) {
			// OMP config rows carry data-omp-key; if the key belongs to another
			// desktop category, switch there and clear nav search/group filter so
			// the row is actually rendered.
			const cat = ompDesktopCategoryFor(pendingFocus).id;
			const wanted = `omp-${cat}`;
			if (target !== wanted) target = wanted;
			setNavQuery("");
			setOmpGroupName(null);
		}
		if (target) setActiveSection(target);
		if (pendingFocus)
			setFocusFlash((f) => ({ key: pendingFocus, n: (f?.n ?? 0) + 1 }));
		useUi.setState({ settingsSection: null, settingsFocus: null });
	}, [pendingSection, pendingFocus]);

	// Scroll the focused row into view and briefly highlight it. Retries for
	// ~3s because OmpConfigSection rows render after `omp config list` returns.
	useEffect(() => {
		if (!focusFlash || !contentRef.current) return;
		const selector = `[data-field-id="${CSS.escape(focusFlash.key)}"],[data-omp-key="${CSS.escape(focusFlash.key)}"]`;
		let found = false;
		const tryScroll = () => {
			const el = contentRef.current?.querySelector<HTMLElement>(selector);
			if (!el) return false;
			found = true;
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.style.transition = "background-color 0.9s ease";
			el.style.backgroundColor =
				"var(--ghost-hover, color-mix(in oklab, currentColor 6%, transparent))";
			setTimeout(() => {
				el.style.backgroundColor = "";
				setTimeout(() => {
					el.style.transition = "";
				}, 950);
			}, 900);
			return true;
		};
		if (tryScroll()) return;
		const t = setInterval(() => {
			if (tryScroll() || found) clearInterval(t);
		}, 160);
		const stop = setTimeout(() => clearInterval(t), 3000);
		return () => {
			clearInterval(t);
			clearTimeout(stop);
		};
	}, [focusFlash, activeSection]);

	// Model catalog for shared ModelSelect pickers
	const [models, setModels] = useState<Model[]>([]);
	useEffect(() => {
		listModels()
			.then((list) => {
				if (Array.isArray(list)) {
					setModels(list);
				}
			})
			.catch(() => {});
	}, []);
	const catalogKeys = useMemo(
		() => new Set(models.map((m) => toModelKey(m.provider, m.id))),
		[models],
	);

	// Local buffer for text inputs to prevent keystroke IPC storms
	const [localSupervisorModel, setLocalSupervisorModel] = useState("");
	const [customSupervisorOpen, setCustomSupervisorOpen] = useState(false);
	const [localIdleMinutes, setLocalIdleMinutes] = useState("0");
	const [localShortcut, setLocalShortcut] = useState("");
	const [localOmpBinary, setLocalOmpBinary] = useState("");
	const [localSupervisorInterval, setLocalSupervisorInterval] = useState("30");
	const [localNewSessionModel, setLocalNewSessionModel] = useState("");
	const [customNewSessionOpen, setCustomNewSessionOpen] = useState(false);
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

	const supervisorModelLabel = useMemo(() => {
		const current = settings?.supervisorModel ?? "";
		if (current === "smol") return "快速模型 (smol)";
		if (current === "default") return "主力模型 (default)";
		if (current === "slow") return "深度模型 (slow)";
		const found = models.find((m) => toModelKey(m.provider, m.id) === current);
		return found?.name ?? current ?? "选择模型";
	}, [settings?.supervisorModel, models]);

	const newSessionModelLabel = useMemo(() => {
		const current = settings?.newSessionModel ?? "";
		if (!current) return "跟随系统默认 (未指定)";
		if (current === "default") return "主力模型 (default)";
		if (current === "smol") return "快速模型 (smol)";
		const found = models.find((m) => toModelKey(m.provider, m.id) === current);
		return found?.name ?? current;
	}, [settings?.newSessionModel, models]);

	const supervisorExtras: ModelExtraOption[] = [
		{ value: "smol", label: "快速模型 (smol)", hint: "内置默认" },
		{ value: "default", label: "主力模型 (default)", hint: "主力角色" },
		{ value: "slow", label: "深度模型 (slow)", hint: "深度角色" },
		{ value: "__custom", label: "自定义模型…", hint: "手动输入" },
	];

	const newSessionExtras: ModelExtraOption[] = [
		{ value: "", label: "留空（跟随系统默认）", hint: "unset" },
		{ value: "default", label: "主力模型 (default)", hint: "内置角色" },
		{ value: "smol", label: "快速模型 (smol)", hint: "内置角色" },
		{ value: "__custom", label: "自定义模型…", hint: "手动输入" },
	];

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
			const text = await readTextFile(path);
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				toast.error("设置文件内容不是合法的 JSON");
				return;
			}
			const validation = validateSettingsShape(parsed);
			if (!validation.ok) {
				toast.error(`设置验证失败: ${validation.error}`);
				return;
			}
			await handleUpdate(validation.value);
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

	const handleInstallExtension = async () => {
		setInstallingExt(true);
		setExtInstallResult(null);
		try {
			const res = await installStatusExtensionGlobally();
			toast.success("全局扩展安装成功");
			setExtInstallResult(res || "安装成功");
		} catch (err) {
			const msg = errMsg(err);
			toast.error(`安装异常: ${msg}`);
			setExtInstallResult(msg);
		} finally {
			setInstallingExt(false);
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
			toast.error(`通知测试失败: ${errMsg(err)}`);
		} finally {
			setTestingNotify(false);
		}
	};

	// Nav search index: section label + keywords + OMP keys/roles/custom terms.
	const navQueryL = navQuery.trim().toLowerCase();
	const navGroupsMatched = useMemo(() => {
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
			if (id.startsWith("omp-")) {
				const catId = id.slice("omp-".length);
				return ompEntries
					.filter((e) => ompDesktopCategoryFor(e.key).id === catId)
					.flatMap((e) => [
						e.key,
						ompConfigTitle(e.key),
						ompConfigDescription(e.key, e.description),
					]);
			}
			if (id === "mcp") {
				// MCP runtime keys (mcp.*) render inside this section too.
				return [
					...registryKeywordsForSection(id),
					...ompEntries
						.filter((e) => e.key.startsWith("mcp."))
						.flatMap((e) => [
							e.key,
							ompConfigTitle(e.key),
							ompConfigDescription(e.key, e.description),
						]),
				];
			}
			if (id === "providers") {
				return [
					"API",
					"密钥",
					"key",
					"provider",
					"anthropic",
					"openai",
					"凭证",
					"oauth",
					"keychain",
					"供应商",
				];
			}
			return registryKeywordsForSection(id);
		};

		return NAV_GROUPS.map((group) => {
			const items = group.items
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
			return { ...group, items };
		}).filter((g) => g.items.length > 0);
	}, [navQueryL, ompEntries]);

	const allMatchedItems = useMemo(
		() => navGroupsMatched.flatMap((g) => g.items),
		[navGroupsMatched],
	);

	// Keep active section inside the filtered set while searching
	useEffect(() => {
		if (!navQueryL) return;
		if (!allMatchedItems.some((s) => s.id === activeSection)) {
			setActiveSection(allMatchedItems[0]?.id ?? activeSection);
		}
	}, [allMatchedItems, navQueryL, activeSection]);

	// In-page scroll to and briefly highlight matched field
	useEffect(() => {
		if (!navQueryL || !contentRef.current) return;
		const match = findMatchingField(activeSection, navQueryL);
		if (!match) return;
		const el = contentRef.current.querySelector<HTMLElement>(
			`[data-field-id="${match.id}"]`,
		);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "nearest" });
			el.classList.add("ring-2", "ring-[#0A84FF]", "bg-[#0A84FF]/10");
			const t = setTimeout(() => {
				el.classList.remove("ring-2", "ring-[#0A84FF]", "bg-[#0A84FF]/10");
			}, 1800);
			return () => clearTimeout(t);
		}
	}, [activeSection, navQueryL]);

	return (
		<div className="flex h-full min-h-0 overflow-hidden bg-transparent text-neutral-200">
			{/* Left Navigation Bar */}
			<div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-[var(--border-divider)] vibrancy-chrome p-2.5">
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
				<nav className="min-h-0 flex-1 space-y-3 overflow-y-auto">
					{navGroupsMatched.length === 0 ? (
						<div className="px-2 py-3 text-center text-[11px] text-neutral-500">
							无匹配设置项
						</div>
					) : (
						navGroupsMatched.map((group) => (
							<div key={group.title} className="space-y-0.5">
								<div className="px-2 py-1 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
									{group.title}
								</div>
								{group.items.map((sec) => {
									const Icon = sec.icon;
									const isActive = activeSection === sec.id;
									const hint =
										sec.hits.length > 0 ? sec.hits.slice(0, 2).join(" · ") : null;
									return (
										<button
											key={sec.id}
											type="button"
											onClick={() => setActiveSection(sec.id)}
											className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all active:scale-[0.98] ${
												isActive
													? "bg-[var(--bg-hover)] text-neutral-100 shadow-sm"
													: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
											}`}
										>
											<Icon className="h-3.5 w-3.5 shrink-0" />
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
								})}
							</div>
						))
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
					{saveNotice &&
						createPortal(
							<div className="fixed bottom-6 right-6 z-[var(--z-toast)] rounded-xl vibrancy-popover shadow-apple-modal hairline px-3.5 py-2 text-xs text-emerald-400">
								{saveNotice}
							</div>,
							document.body,
						)}

					{/* 1. General Section */}
					{activeSection === "general" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									通用设置
								</h2>
								<p className="text-xs text-neutral-400">
									workbench 界面与行为配置
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="capsuleVisible">
									<Toggle
										label="顶部胶囊 (Top Capsule)"
										description="在窗口顶部显示轻量胶囊栏，提供全局状态、快捷切换与通知"
										checked={settings?.capsuleVisible ?? true}
										onChange={(v) => handleUpdate({ capsuleVisible: v })}
									/>
								</div>

								<div
									data-field-id="smartContextRouting"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="智能上下文路由"
										description="新会话自动检测关联项目并注入最近工作区上下文"
										checked={settings?.smartContextRouting ?? true}
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
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									外观
								</h2>
								<p className="text-xs text-neutral-400">
									主题、聊天字号与界面密度
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="theme">
									<div className="text-xs font-medium text-neutral-200">主题</div>
									<div className="mt-1 text-[11px] text-neutral-400">
										默认跟随系统明暗自动切换；也可固定深色或浅色主题
									</div>
									<div className="mt-3">
										<ThemePicker />
									</div>
								</div>

								<div
									data-field-id="fontSize"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="text-xs font-medium text-neutral-200">
										聊天字号
									</div>
									<div className="mt-1 text-[11px] text-neutral-400">
										会话消息正文的文字大小
									</div>
									<div className="mt-2 inline-flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
										{FONT_SIZES.map((fs) => (
											<button
												key={fs.id}
												type="button"
												onClick={() => setFontSize(fs.id)}
												className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
													fontSize === fs.id
														? "bg-[var(--bg-panel)] text-neutral-100 shadow-sm"
														: "text-neutral-400 hover:text-neutral-200"
												}`}
											>
												{fs.name}
											</button>
										))}
									</div>
								</div>

								<div
									data-field-id="uiDensity"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="text-xs font-medium text-neutral-200">
										界面密度
									</div>
									<div className="mt-1 text-[11px] text-neutral-400">
										整体界面的缩放程度
									</div>
									<div className="mt-2 inline-flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
										{UI_SCALES.map((scale) => (
											<button
												key={scale.id}
												type="button"
												onClick={() => setUiScale(scale.id)}
												className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
													uiScale === scale.id
														? "bg-[var(--bg-panel)] text-neutral-100 shadow-sm"
														: "text-neutral-400 hover:text-neutral-200"
												}`}
											>
												{scale.name}
											</button>
										))}
									</div>
								</div>

								<div
									data-field-id="uiScale"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="flex items-center justify-between">
										<div>
											<div className="text-xs font-medium text-neutral-200">
												界面缩放
											</div>
											<div className="mt-1 text-[11px] text-neutral-400">
												调节窗口视图比例（快捷键：Cmd/Ctrl +/-，重置：Cmd/Ctrl 0）
											</div>
										</div>
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={zoomOut}
												disabled={zoom <= minZoom}
												className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-40"
											>
												-
											</button>
											<button
												type="button"
												onClick={resetZoom}
												className="min-w-14 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-center font-mono text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)]"
											>
												{zoom}%
											</button>
											<button
												type="button"
												onClick={zoomIn}
												disabled={zoom >= maxZoom}
												className="rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-[var(--bg-hover)] disabled:opacity-40"
											>
												+
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* 3. API providers */}
					{activeSection === "providers" && (
						<div data-field-id="providerList">
							<ProviderPanel />
						</div>
					)}

					{/* 4. Model Roles */}
					{activeSection === "omp-roles" && (
						<div className="space-y-6" data-field-id="modelRolesPanel">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									模型角色与回退链
								</h2>
								<p className="text-xs text-neutral-400">
									为每类任务指定主力模型与回退顺序（对应 omp /model 的 Roles 视图），写入 ~/.omp/agent/config.yml
								</p>
							</div>
							<ModelRolesSection query={navQuery.trim()} />
						</div>
					)}

					{/* 5. Sessions (absorbs Checkpoints as sub-card) */}
					{activeSection === "sessions" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									会话管理
								</h2>
								<p className="text-xs text-neutral-400">
									会话生命周期与默认选项
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="defaultApprovalMode">
									<label className="block text-xs font-medium text-neutral-200">
										默认审批模式 (Approval Mode)
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
										新会话启动时默认使用的工具执行权限
									</div>
									<div className="mt-2">
										<NativeSelect
											value={settings?.defaultApprovalMode ?? "write"}
											onChange={(e) =>
												handleUpdate({ defaultApprovalMode: e.target.value })
											}
											className="w-full text-xs"
										>
											<option value="always-ask">总是询问 (always-ask)</option>
											<option value="write">写操作需确认 (write)</option>
											<option value="yolo">全自动执行 (yolo)</option>
										</NativeSelect>
									</div>
								</div>

								<div
									data-field-id="idleSuspendMinutes"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<label className="block text-xs font-medium text-neutral-200">
										空闲挂起时长 (分钟)
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
										会话无操作超过指定时长后自动挂起后台 RPC 进程；0 表示永不挂起
									</div>
									<input
										type="number"
										min={0}
										max={1440}
										value={localIdleMinutes}
										onChange={(e) => setLocalIdleMinutes(e.target.value)}
										onBlur={commitIdleMinutes}
										onKeyDown={(e) => {
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-32 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div
									data-field-id="sessionTurnAutoRefresh"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="自动刷新会话摘要"
										description="每一轮对话完成后在后台自动提取最新摘要并更新列表标题"
										checked={settings?.sessionTurnAutoRefresh ?? true}
										onChange={(v) => handleUpdate({ sessionTurnAutoRefresh: v })}
									/>
								</div>

								<div
									data-field-id="newSessionModel"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="flex items-center justify-between">
										<div>
											<label className="block text-xs font-medium text-neutral-200">
												新会话默认模型
											</label>
											<div className="mt-1 text-[11px] text-neutral-400">
												启动新会话时使用的默认模型，留空跟随 OMP 自身默认配置
											</div>
										</div>
										<ModelSelect
											direction="down"
											widthClass="w-[360px]"
											label={newSessionModelLabel}
											buttonClass="h-7 flex min-w-[140px] max-w-[240px] items-center justify-between rounded-lg hairline bg-[var(--well-bg)] px-2.5 text-left text-[11px] text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
											models={models}
											currentValue={
												catalogKeys.has(settings?.newSessionModel ?? "")
													? (settings?.newSessionModel ?? "")
													: ""
											}
											extras={newSessionExtras}
											onSelect={(v) => {
												if (v === "__custom") {
													setCustomNewSessionOpen(true);
												} else {
													setCustomNewSessionOpen(false);
													setLocalNewSessionModel(v);
													void handleUpdate({
														newSessionModel: v === "" ? null : v,
													});
												}
											}}
										/>
									</div>
									{(customNewSessionOpen ||
										(Boolean(settings?.newSessionModel) &&
											!catalogKeys.has(settings?.newSessionModel ?? "") &&
											!["default", "smol"].includes(
												settings?.newSessionModel ?? "",
											))) && (
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
											placeholder="输入自定义模型标识，例如: claude-3-5-sonnet"
											className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
										/>
									)}
								</div>
							</div>

							{/* Turn checkpoints absorbed as sub-card */}
							<CheckpointsSection />
						</div>
					)}

					{/* 6. Inbox (renamed from todos) */}
					{activeSection === "inbox" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									收件箱
								</h2>
								<p className="text-xs text-neutral-400">
									自动化待办检测与只读 LLM 监工建议系统
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="systemDetection">
									<Toggle
										label="系统待办检测"
										description="自动捕获会话审批、提问、报错、中断与待验收事件加入待办队列"
										checked={settings?.systemDetection ?? true}
										onChange={(v) => handleUpdate({ systemDetection: v })}
									/>
								</div>

								<div
									data-field-id="supervisorEnabled"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="后台监工建议 (Supervisor)"
										description="定期基于会话摘要与收集箱生成建议（只读，无执行权限）"
										checked={settings?.supervisorEnabled ?? false}
										onChange={(v) => handleUpdate({ supervisorEnabled: v })}
									/>
								</div>

								<div
									data-field-id="supervisorModel"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="flex items-center justify-between">
										<div>
											<label className="block text-xs font-medium text-neutral-200">
												监工模型
											</label>
											<div className="mt-1 text-[11px] text-neutral-400">
												监工调用 omp -p 时指定的轻量模型，建议保持快速或低成本模型
											</div>
										</div>
										<ModelSelect
											direction="down"
											widthClass="w-[360px]"
											label={supervisorModelLabel}
											buttonClass="h-7 flex min-w-[140px] max-w-[240px] items-center justify-between rounded-lg hairline bg-[var(--well-bg)] px-2.5 text-left text-[11px] text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
											models={models}
											currentValue={
												catalogKeys.has(settings?.supervisorModel ?? "")
													? (settings?.supervisorModel ?? "")
													: ""
											}
											extras={supervisorExtras}
											onSelect={(v) => {
												if (v === "__custom") {
													setCustomSupervisorOpen(true);
												} else {
													setCustomSupervisorOpen(false);
													setLocalSupervisorModel(v);
													void handleUpdate({ supervisorModel: v });
												}
											}}
										/>
									</div>
									{(customSupervisorOpen ||
										(!catalogKeys.has(settings?.supervisorModel ?? "") &&
											!["smol", "default", "slow"].includes(
												settings?.supervisorModel ?? "",
											))) && (
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
											placeholder="输入自定义模型标识，例如: smol, gpt-4o-mini"
											className="mt-2 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
										/>
									)}
								</div>

								<div
									data-field-id="supervisorIntervalMinutes"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<label className="block text-xs font-medium text-neutral-200">
										监工触发间隔 (分钟)
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
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
											if (isComposing(e)) return;
											if (e.key === "Enter") {
												e.currentTarget.blur();
											}
										}}
										className="mt-2 w-32 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono tabular-nums text-xs text-neutral-200 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none transition-all"
									/>
								</div>

								<div
									data-field-id="homeShowCompletedTodos"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="默认展开已处理待办"
										description="首页待办卡片默认展开显示已处理的历史待办项"
										checked={settings?.homeShowCompletedTodos ?? false}
										onChange={(v) => handleUpdate({ homeShowCompletedTodos: v })}
									/>
								</div>
							</div>
						</div>
					)}

					{/* 7. Notifications */}
					{activeSection === "notifications" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									通知提醒
								</h2>
								<p className="text-xs text-neutral-400">
									系统原生通知、Dock 角标与提示音设置
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="notifyTurnEnd">
									<Toggle
										label="轮次结束通知"
										description="Agent 完成本轮思考并等待验收时触发系统通知"
										checked={settings?.notifyTurnEnd ?? true}
										onChange={(v) => handleUpdate({ notifyTurnEnd: v })}
									/>
								</div>

								<div
									data-field-id="notifyApproval"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="审批与提问通知"
										description="Agent 请求危险工具审批或需要用户输入回答时通知"
										checked={settings?.notifyApproval ?? true}
										onChange={(v) => handleUpdate({ notifyApproval: v })}
									/>
								</div>

								<div
									data-field-id="notifyExit"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="异常与中断通知"
										description="会话因报错退出或进程意外终止时通知"
										checked={settings?.notifyExit ?? true}
										onChange={(v) => handleUpdate({ notifyExit: v })}
									/>
								</div>

								<div
									data-field-id="notifySound"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="通知提示音"
										description="发送通知时伴随系统默认提示音"
										icon={settings?.notifySound ? Volume2 : VolumeX}
										checked={settings?.notifySound ?? true}
										onChange={(v) => handleUpdate({ notifySound: v })}
									/>
								</div>

								<div
									data-field-id="dockBadgeEnabled"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<Toggle
										label="Dock 角标"
										description="在程序坞图标上显示待处理的待办数量"
										checked={settings?.dockBadgeEnabled ?? true}
										onChange={(v) => handleUpdate({ dockBadgeEnabled: v })}
									/>
								</div>

								<div
									data-field-id="notifyQuiet"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<label className="block text-xs font-medium text-neutral-200">
										免打扰时段
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
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
										{(settings?.notifyQuietFrom || settings?.notifyQuietTo) && (
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

								<div
									data-field-id="notifyTest"
									className="border-t border-[var(--border-divider)] pt-4 flex items-center justify-between"
								>
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

					{/* 8. Mobile Access */}
					{activeSection === "mobile" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									手机访问
								</h2>
								<p className="text-xs text-neutral-400">
									通过局域网或 Cloudflare Tunnel 在手机移动端实时查看与审批待办
								</p>
							</div>

							<MobilePanel />
						</div>
					)}

					{/* MCP servers (own section; not an omp-* config category) */}
					{activeSection === "mcp" && (
						<McpSection
							cwd={projectCwd}
							query={navQuery.trim()}
							onNavigateSection={(id) =>
								setActiveSection(id.startsWith("omp-") ? id : `omp-${id}`)
							}
						/>
					)}

					{/* Plugins + extensions */}
					{activeSection === "plugins" && (
						<PluginsSection
							cwd={projectCwd}
							query={navQuery.trim()}
							onNavigateSection={(id) =>
								setActiveSection(id.startsWith("omp-") ? id : `omp-${id}`)
							}
						/>
					)}

					{/* 9. OMP category sections (model, thinking, retry, context, tools, tasks, providers, advanced) */}
					{ompCategory !== null && (
						<OmpConfigSection
							activeTab={ompCategory}
							onTabChange={(tab) =>
								setActiveSection(tab.startsWith("omp-") ? tab : `omp-${tab}`)
							}
							query={navQuery.trim()}
							activeGroupName={ompGroupName}
							onGroupChange={setOmpGroupName}
						/>
					)}

					{/* 10. Advanced */}
					{activeSection === "advanced" && (
						<div className="space-y-6">
							<div>
								<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
									高级配置
								</h2>
								<p className="text-xs text-neutral-400">
									命令行可执行路径与状态扩展
								</p>
							</div>

							<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<div data-field-id="quickCaptureShortcut">
									<label className="block text-xs font-medium text-neutral-200">
										全局快捷键 (快速捕获)
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
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

								<div
									data-field-id="ompBinary"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<label className="block text-xs font-medium text-neutral-200">
										OMP 命令行程序 (omp binary)
									</label>
									<div className="mt-1 text-[11px] text-neutral-400">
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

								<div
									data-field-id="installStatusExtension"
									className="border-t border-[var(--border-divider)] pt-4 flex items-center justify-between"
								>
									<div>
										<div className="text-xs font-medium text-neutral-200">
											安装全局状态扩展
										</div>
										<div className="text-[11px] text-neutral-400">
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

								<div
									data-field-id="dataManagement"
									className="border-t border-[var(--border-divider)] pt-4"
								>
									<div className="text-xs font-medium text-neutral-200">
										数据管理
									</div>
									<div className="mt-1 text-[11px] text-neutral-400">
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
