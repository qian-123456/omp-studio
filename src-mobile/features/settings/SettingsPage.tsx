import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { EmptyState, PageHeader, PullToRefresh, Spinner } from "../../ui";
import { SETTINGS_GROUPS, type SettingsItemDef, type SheetId } from "./settingsGroups";
import {
	AboutSheet,
	AppearanceSheet,
	ConnectionSheet,
	DoctorSheet,
	GeneralSheet,
	GuideSheet,
	HelperModelsSheet,
	InboxSheet,
	McpSheet,
	MemorySheet,
	NotifySheet,
	PrivacySheet,
	PromptCompositionSheet,
	RulesFilesSheet,
	SessionsSheet,
	SkillsSheet,
	SubagentsSheet,
	ThinkingSheet,
	ToolsSheet,
	WebSheet,
} from "./sheets";
import { isApprovalMode, type ApprovalMode, type OmpValue } from "./settingsMap";
import type { MobileInfo } from "./sections";

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

/** Project scope for the roles / fallbacks sub-pages */
let scopeCwd: string | null = null;

export const withCwd = (path: string, cwd: string | null): string =>
	cwd ? `${path}?cwd=${encodeURIComponent(cwd)}` : path;

export function SettingsPage() {
	const [data, setData] = useState<SettingsData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dirs, setDirs] = useState<DirEntry[]>([]);
	const [cwd, setCwd] = useState<string | null>(scopeCwd);
	const [activeSheet, setActiveSheet] = useState<SheetId | null>(null);

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

	const mode: ApprovalMode | null = isApprovalMode(data?.defaultApprovalMode)
		? data.defaultApprovalMode
		: null;

	const handleItemClick = (item: SettingsItemDef) => {
		if (item.navigateTo) {
			switch (item.navigateTo) {
				case "settingsProviders":
					nav.push(paths.settingsProviders());
					break;
				case "settingsRoles":
					nav.push(withCwd(paths.settingsRoles(), cwd));
					break;
				case "settingsFallbacks":
					nav.push(withCwd(paths.settingsFallbacks(), cwd));
					break;
				case "settingsContext":
					nav.push(paths.settingsContext());
					break;
				case "quota":
					nav.push(paths.quota());
					break;
			}
			return;
		}

		setActiveSheet(item.id as SheetId);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title="设置" />

			<PullToRefresh onRefresh={load} className="min-h-0 flex-1 overflow-y-auto">
				<div className="space-y-6 px-4 py-3 pb-[calc(var(--m-safe-bottom)+32px)]">
					{/* Loading & Error */}
					{!data && !error && (
						<div className="flex justify-center py-16">
							<Spinner />
						</div>
					)}
					{error && !data && (
						<EmptyState
							title="加载失败"
							hint={error}
							action={
								<button
									type="button"
									onClick={() => void load()}
									className="min-h-11 rounded-m-md border border-m-border px-4 text-m-sm whitespace-nowrap"
								>
									重试
								</button>
							}
						/>
					)}

					{/* Project Scope Selector */}
					<div className="rounded-2xl border border-m-border bg-m-bg-elev p-3">
						<div className="flex items-center gap-3">
							<span className="text-m-xs font-medium whitespace-nowrap text-m-text-3">配置目标</span>
							<select
								aria-label="配置目标"
								value={cwd ?? ""}
								onChange={(e) => {
									scopeCwd = e.target.value || null;
									setCwd(scopeCwd);
								}}
								className="min-h-11 min-w-0 flex-1 rounded-m-md border border-m-border bg-m-bg px-2.5 text-m-sm text-m-text"
							>
								<option value="">全局配置（对所有项目生效）</option>
								{dirs.map((d) => (
									<option key={d.path} value={d.path}>
										项目：{d.label || d.path.split("/").pop()}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Grouped Card Lists */}
					{SETTINGS_GROUPS.map((group) => (
						<section key={group.id} className="space-y-2">
							<h2 className="px-1 text-m-xs font-semibold tracking-wide text-m-text-3">
								{group.title}
							</h2>

							<div className="overflow-hidden rounded-2xl border border-m-border bg-m-bg-elev shadow-m-card divide-y divide-m-border">
								{group.items.map((item) => {
									const Icon = item.icon;
									return (
										<button
											key={item.id}
											type="button"
											onClick={() => handleItemClick(item)}
											className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-m-surface-hover"
										>
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-m-surface text-m-text-2">
												<Icon size={18} />
											</div>

											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<span className="text-m-md font-medium text-m-text">
														{item.label}
													</span>
													{item.badge && (
														<span className="rounded-m-pill bg-m-surface-2 px-2 py-0.2 text-[10px] text-m-text-3">
															{item.badge}
														</span>
													)}
												</div>
												<p className="truncate text-m-xs text-m-text-3">{item.desc}</p>
											</div>

											<ChevronRight size={18} className="text-m-text-3 shrink-0" />
										</button>
									);
								})}
							</div>
						</section>
					))}
				</div>
			</PullToRefresh>

			{/* Bottom Sheets */}
			<GeneralSheet
				open={activeSheet === "general"}
				onClose={() => setActiveSheet(null)}
				mode={mode}
				defaultModel={data?.defaultModel}
				defaultModelSource={data?.defaultModelSource}
				onModeChange={(m) => setData((d) => (d ? { ...d, defaultApprovalMode: m } : d))}
			/>

			<AppearanceSheet
				open={activeSheet === "appearance"}
				onClose={() => setActiveSheet(null)}
			/>

			<NotifySheet
				open={activeSheet === "notifications"}
				onClose={() => setActiveSheet(null)}
			/>

			<PrivacySheet
				open={activeSheet === "privacy"}
				onClose={() => setActiveSheet(null)}
			/>

			<ThinkingSheet
				open={activeSheet === "thinking"}
				onClose={() => setActiveSheet(null)}
			/>

			<HelperModelsSheet
				open={activeSheet === "helper-models"}
				onClose={() => setActiveSheet(null)}
			/>

			<SessionsSheet
				open={activeSheet === "sessions"}
				onClose={() => setActiveSheet(null)}
			/>

			<InboxSheet
				open={activeSheet === "inbox"}
				onClose={() => setActiveSheet(null)}
			/>

			<DoctorSheet
				open={activeSheet === "doctor"}
				onClose={() => setActiveSheet(null)}
			/>

			<RulesFilesSheet
				open={activeSheet === "agents-md"}
				onClose={() => setActiveSheet(null)}
			/>

			<PromptCompositionSheet
				open={activeSheet === "prompt-composition"}
				onClose={() => setActiveSheet(null)}
			/>

			<ToolsSheet
				open={activeSheet === "tools"}
				onClose={() => setActiveSheet(null)}
			/>

			<SubagentsSheet
				open={activeSheet === "subagents"}
				onClose={() => setActiveSheet(null)}
			/>

			<MemorySheet
				open={activeSheet === "memory"}
				onClose={() => setActiveSheet(null)}
			/>

			<SkillsSheet
				open={activeSheet === "skills"}
				onClose={() => setActiveSheet(null)}
			/>

			<ConnectionSheet
				open={activeSheet === "connection"}
				onClose={() => setActiveSheet(null)}
				mobile={data?.mobile}
				appVersion={data?.appVersion}
			/>

			<McpSheet
				open={activeSheet === "mcp"}
				onClose={() => setActiveSheet(null)}
			/>

			<WebSheet
				open={activeSheet === "web"}
				onClose={() => setActiveSheet(null)}
			/>

			<GuideSheet
				open={activeSheet === "guide"}
				onClose={() => setActiveSheet(null)}
			/>

			<AboutSheet
				open={activeSheet === "about"}
				onClose={() => setActiveSheet(null)}
				appVersion={data?.appVersion}
			/>
		</div>
	);
}
