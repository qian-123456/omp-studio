import { Check, FolderCog, Globe2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { usePrefs } from "../../core/stores/prefs";
import { BottomSheet, Button, EmptyState, IconButton, ListGroup, ListRow, MenuRow, PullToRefresh, Spinner, TopBar } from "../../ui";
import { OmpError, OmpSettingsGroup } from "./OmpSettings";
import { QUOTA_ITEM, SETTINGS_GROUPS, type SettingsItemDef, type SheetId } from "./settingsGroups";
import {
	AboutSheet,
	AppearanceSheet,
	ConnectionSheet,
	DoctorSheet,
	GeneralSheet,
	GuideSheet,
	InboxSheet,
	McpSheet,
	MemorySheet,
	NotifySheet,
	PrivacySheet,
	PromptCompositionSheet,
	RulesFilesSheet,
	SessionsSheet,
	SubagentsSheet,
	ToolsSheet,
	WebSheet,
} from "./sheets";
import type { MobileInfo } from "./sheets/ConnectionSheet";
import { APPROVAL_MODES, isApprovalMode, SCHEMES, type ApprovalMode, type OmpValue } from "./settingsMap";

interface SettingsData {
	appVersion?: string | null;
	mobile?: MobileInfo;
	defaultModel?: string | null;
	defaultModelSource?: string | null;
	defaultApprovalMode?: string | null;
	omp?: Record<string, OmpValue>;
	ompError?: string | null;
}

interface DirEntry {
	path: string;
	label?: string;
}

/** Project scope for the roles / fallbacks sub-pages; survives navigating back to settings. */
let scopeCwd: string | null = null;

export const withCwd = (path: string, cwd: string | null): string => (cwd ? `${path}?cwd=${encodeURIComponent(cwd)}` : path);

const dirName = (d: DirEntry): string => d.label || d.path.split("/").filter(Boolean).pop() || d.path;

const ICON = { size: 22, strokeWidth: 1.75 } as const;

export function SettingsPage() {
	const [data, setData] = useState<SettingsData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dirs, setDirs] = useState<DirEntry[]>([]);
	const [cwd, setCwd] = useState<string | null>(scopeCwd);
	const [scopeOpen, setScopeOpen] = useState(false);
	const [activeSheet, setActiveSheet] = useState<SheetId | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const scheme = usePrefs((s) => s.scheme);

	const load = useCallback(async () => {
		setError(null);
		try {
			const [s, d] = await Promise.all([
				api<SettingsData>("GET", "/left/settings"),
				api<{ dirs: DirEntry[] }>("GET", "/left/dirs").catch(() => ({ dirs: [] })),
			]);
			setData(s);
			setDirs(d.dirs ?? []);
		} catch (e) {
			setError(errorMessage(e, "加载设置失败"));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const mode: ApprovalMode | null = isApprovalMode(data?.defaultApprovalMode) ? data.defaultApprovalMode : null;
	const setOmp = useCallback((key: string, value: OmpValue) => setData((d) => (d ? { ...d, omp: { ...d.omp, [key]: value } } : d)), []);
	// Retain the selected instance on close for its exit animation and local draft.
	const close = () => setSheetOpen(false);
	const chooseScope = (next: string | null) => {
		scopeCwd = next;
		setCwd(next);
		setScopeOpen(false);
	};
	const scopeDir = cwd ? dirs.find((d) => d.path === cwd) : undefined;

	const open = (item: SettingsItemDef) => {
		switch (item.navigateTo) {
			case "settingsProviders":
				return nav.push(paths.settingsProviders());
			case "settingsRoles":
				return nav.push(withCwd(paths.settingsRoles(), cwd));
			case "settingsFallbacks":
				return nav.push(withCwd(paths.settingsFallbacks(), cwd));
			case "settingsContext":
				return nav.push(paths.settingsContext());
			case "quota":
				return nav.push(paths.quota());
			case "skills":
				return nav.push(paths.skills());
			case undefined:
				setActiveSheet(item.id as SheetId);
				setSheetOpen(true);
		}
	};

	/** Short current value shown at the right of a row. */
	const valueOf = (id: SettingsItemDef["id"]): string | undefined => {
		if (id === "appearance") return SCHEMES.find((s) => s.value === scheme)?.label;
		if (id === "general" && mode) return APPROVAL_MODES.find((m) => m.value === mode)?.label;
		if (id === "connection" && data?.mobile) return data.mobile.running ? "已连接" : "未运行";
		return undefined;
	};

	const row = (item: SettingsItemDef) => {
		const Icon = item.icon;
		const value = valueOf(item.id);
		return (
			<ListRow
				key={item.id}
				icon={<Icon {...ICON} />}
				title={<span className="whitespace-nowrap">{item.label}</span>}
				subtitle={item.id === "thinking" ? "在对话顶部点模型名称，可切换当前会话的思考深度；采样参数由电脑端管理。" : undefined}
				right={value}
				chevron={item.id !== "thinking"}
				onClick={item.id === "thinking" ? undefined : () => open(item)}
			/>
		);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<TopBar right={<IconButton variant="filled" icon={<X size={20} />} label="关闭" onClick={() => nav.back()} />} />

			<PullToRefresh onRefresh={load} className="m-noscrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="flex flex-col gap-2 pb-[calc(var(--m-safe-bottom)+32px)]">
					<h1 className="px-6 pt-1 pb-3 text-m-title font-medium">设置</h1>

					<ListGroup>{row(QUOTA_ITEM)}</ListGroup>

					{!data && !error && (
						<div className="flex justify-center py-6">
							<Spinner />
						</div>
					)}
					{error && !data && (
						<EmptyState
							title="设置没有加载出来"
							hint={error}
							action={
								<Button variant="tonal" onClick={() => void load()}>
									重试
								</Button>
							}
						/>
					)}

					{SETTINGS_GROUPS.map((group) => (
						<Fragment key={group.id}>
							<ListGroup title={group.title}>
								{group.id === "models" && dirs.length > 0 && (
									<ListRow
										icon={<FolderCog {...ICON} />}
										title="配置范围"
										subtitle="模型角色和备用模型保存到这里"
										right={scopeDir ? dirName(scopeDir) : "全局"}
										chevron
										onClick={() => setScopeOpen(true)}
									/>
								)}
								{group.items.map(row)}
							</ListGroup>
							{group.id === "models" && (
								<>
									{data?.ompError && <OmpError omp={data.omp} ompError={data.ompError} />}
									<OmpSettingsGroup keys={["hideThinkingBlock"]} omp={data?.omp} onValue={setOmp} />
								</>
							)}
						</Fragment>
					))}
				</div>
			</PullToRefresh>

			<BottomSheet open={scopeOpen} onClose={() => setScopeOpen(false)} title="配置范围" subtitle="选择模型角色和备用模型对谁生效">
				<div className="pb-3">
					<MenuRow
						icon={<Globe2 {...ICON} />}
						label="全局配置"
						hint="对所有项目生效"
						selected={cwd == null}
						right={cwd == null ? <Check size={20} className="text-m-accent" /> : undefined}
						onClick={() => chooseScope(null)}
					/>
					{dirs.map((d) => (
						<MenuRow
							key={d.path}
							icon={<FolderCog {...ICON} />}
							label={dirName(d)}
							hint={<span className="break-all">{d.path}</span>}
							selected={cwd === d.path}
							right={cwd === d.path ? <Check size={20} className="text-m-accent" /> : undefined}
							onClick={() => chooseScope(d.path)}
						/>
					))}
				</div>
			</BottomSheet>

			{activeSheet === "general" && <GeneralSheet
				open={sheetOpen}
				onClose={close}
				mode={mode}
				defaultModel={data?.defaultModel}
				defaultModelSource={data?.defaultModelSource}
				onModeChange={(m) => setData((d) => (d ? { ...d, defaultApprovalMode: m } : d))}
			/>}
			{activeSheet === "appearance" && <AppearanceSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "notifications" && <NotifySheet open={sheetOpen} onClose={close} />}
			{activeSheet === "privacy" && <PrivacySheet open={sheetOpen} onClose={close} />}
			{activeSheet === "sessions" && <SessionsSheet open={sheetOpen} onClose={close} omp={data?.omp} ompError={data?.ompError} onOmp={setOmp} />}
			{activeSheet === "inbox" && <InboxSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "doctor" && <DoctorSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "agents-md" && <RulesFilesSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "prompt-composition" && <PromptCompositionSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "tools" && <ToolsSheet open={sheetOpen} onClose={close} omp={data?.omp} ompError={data?.ompError} onOmp={setOmp} />}
			{activeSheet === "subagents" && <SubagentsSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "memory" && <MemorySheet open={sheetOpen} onClose={close} />}
			{activeSheet === "connection" && <ConnectionSheet open={sheetOpen} onClose={close} mobile={data?.mobile} appVersion={data?.appVersion} />}
			{activeSheet === "mcp" && <McpSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "web" && <WebSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "guide" && <GuideSheet open={sheetOpen} onClose={close} />}
			{activeSheet === "about" && <AboutSheet open={sheetOpen} onClose={close} appVersion={data?.appVersion} />}
		</div>
	);
}
