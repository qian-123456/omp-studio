import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertCircle,
	FolderOpen,
	MessageSquarePlus,
	Power,
	Puzzle,
	RefreshCw,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Markdown } from "../../features/chat/markdown";
import { ompConfigList, ompConfigSet, skillsRead } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSkillsStore } from "./store";

const INITIAL_PAGE_SIZE = 50;
const PAGE_STEP = 50;

/** Drop a leading YAML frontmatter block; name/description are shown in the header. */
function stripFrontmatter(text: string): string {
	const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	return m ? text.slice(m[0].length).trimStart() : text;
}

export function SkillsPage() {
	const catalog = useSkillsStore((s) => s.catalog);
	const loading = useSkillsStore((s) => s.loading);
	const error = useSkillsStore((s) => s.error);
	const activeTab = useSkillsStore((s) => s.activeTab);
	const searchQuery = useSkillsStore((s) => s.searchQuery);
	const selectedSkillPath = useSkillsStore((s) => s.selectedSkillPath);
	const selectedExtensionPath = useSkillsStore((s) => s.selectedExtensionPath);

	const loadCatalog = useSkillsStore((s) => s.loadCatalog);
	const refresh = useSkillsStore((s) => s.refresh);
	const setActiveTab = useSkillsStore((s) => s.setActiveTab);
	const setSearchQuery = useSkillsStore((s) => s.setSearchQuery);
	const setSelectedSkill = useSkillsStore((s) => s.setSelectedSkill);
	const setSelectedExtension = useSkillsStore((s) => s.setSelectedExtension);
	const updateExtensionEnabled = useSkillsStore((s) => s.updateExtensionEnabled);

	// Project scope follows the selected (or last viewed) session's cwd.
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const scopeSessionId = useUi((s) => s.selectedSessionId ?? s.lastSessionId);
	const projectCwd = useSessions((s) =>
		scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null,
	);

	// Load catalog on mount or when project scope cwd changes
	useEffect(() => {
		loadCatalog(projectCwd);
	}, [projectCwd, loadCatalog]);

	// Progressive reveal count for large lists
	const [visibleLimit, setVisibleLimit] = useState(INITIAL_PAGE_SIZE);

	// Detail state for reading SKILL.md
	const [detailContent, setDetailContent] = useState<string | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);

	// Extension toggle in-flight tracker
	const [togglingPath, setTogglingPath] = useState<string | null>(null);

	// Read SKILL.md when selected skill changes
	useEffect(() => {
		if (!selectedSkillPath) {
			setDetailContent(null);
			setDetailError(null);
			return;
		}

		let cancelled = false;
		setDetailLoading(true);
		setDetailError(null);

		skillsRead(selectedSkillPath)
			.then((text) => {
				if (!cancelled) {
					setDetailContent(stripFrontmatter(text));
					setDetailLoading(false);
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setDetailError(err instanceof Error ? err.message : String(err));
					setDetailLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [selectedSkillPath]);

	// Filtered skills
	const filteredSkills = useMemo(() => {
		if (!catalog?.skills) return [];
		const q = searchQuery.trim().toLowerCase();
		if (!q) return catalog.skills;
		return catalog.skills.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.description.toLowerCase().includes(q),
		);
	}, [catalog?.skills, searchQuery]);

	// Filtered extensions
	const filteredExtensions = useMemo(() => {
		if (!catalog?.extensions) return [];
		const q = searchQuery.trim().toLowerCase();
		if (!q) return catalog.extensions;
		return catalog.extensions.filter(
			(e) =>
				e.name.toLowerCase().includes(q) ||
				e.path.toLowerCase().includes(q),
		);
	}, [catalog?.extensions, searchQuery]);

	// Reset limit on search or tab change
	useEffect(() => {
		setVisibleLimit(INITIAL_PAGE_SIZE);
	}, [searchQuery, activeTab]);

	// Grouping skills by source
	const groupedSkills = useMemo(() => {
		const groups: { source: string; label: string; items: typeof filteredSkills }[] = [];
		const projectSkills = filteredSkills.filter((s) => s.source === "project");
		const userSkills = filteredSkills.filter((s) => s.source === "user");
		const otherSkills = filteredSkills.filter(
			(s) => s.source !== "project" && s.source !== "user",
		);

		if (projectSkills.length > 0) {
			groups.push({ source: "project", label: "当前项目", items: projectSkills });
		}
		if (userSkills.length > 0) {
			groups.push({ source: "user", label: "全局", items: userSkills });
		}
		if (otherSkills.length > 0) {
			groups.push({ source: "other", label: "其他来源", items: otherSkills });
		}

		return groups;
	}, [filteredSkills]);

	// Grouping extensions by source
	const groupedExtensions = useMemo(() => {
		const groups: { source: string; label: string; items: typeof filteredExtensions }[] = [];
		const projectExts = filteredExtensions.filter((e) => e.source === "project");
		const userExts = filteredExtensions.filter((e) => e.source === "user");
		const otherExts = filteredExtensions.filter(
			(e) => e.source !== "project" && e.source !== "user",
		);

		if (projectExts.length > 0) {
			groups.push({ source: "project", label: "当前项目", items: projectExts });
		}
		if (userExts.length > 0) {
			groups.push({ source: "user", label: "全局", items: userExts });
		}
		if (otherExts.length > 0) {
			groups.push({ source: "other", label: "其他来源", items: otherExts });
		}

		return groups;
	}, [filteredExtensions]);

	// Selected skill item
	const activeSkill = useMemo(
		() => catalog?.skills.find((s) => s.path === selectedSkillPath) ?? null,
		[catalog?.skills, selectedSkillPath],
	);

	// Selected extension item
	const activeExtension = useMemo(
		() => catalog?.extensions.find((e) => e.path === selectedExtensionPath) ?? null,
		[catalog?.extensions, selectedExtensionPath],
	);

	// Action: Use in current session composer
	const handleInsertIntoComposer = (skillName: string) => {
		if (!selectedSessionId) {
			toast.error("当前未选择会话，请先在侧边栏选择一个会话");
			return;
		}

		const existingDraft = useComposer.getState().drafts[selectedSessionId] ?? "";
		const invocation = `/skill:${skillName} `;
		const newDraft = existingDraft ? `${invocation}${existingDraft}` : invocation;

		useComposer.getState().setDraft(selectedSessionId, newDraft);
		useComposer.getState().focusComposer(selectedSessionId);
		useUi.getState().setCenter("session");
		toast.success(`已插入 /skill:${skillName} 到会话输入框`);
	};

	// Action: Reveal in Finder
	const handleRevealInFinder = async (path: string) => {
		try {
			await revealItemInDir(path);
		} catch (err) {
			toast.error(`在访达中显示失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// Action: Toggle extension enabled
	const handleToggleExtension = async (extName: string, extPath: string, currentlyEnabled: boolean) => {
		if (togglingPath) return;
		setTogglingPath(extPath);

		try {
			// Read current disabledExtensions from omp config
			const configList = await ompConfigList();
			const entry = configList.entries.find((e) => e.key === "disabledExtensions");

			let currentDisabled: string[] = [];
			if (entry && Array.isArray(entry.value)) {
				currentDisabled = entry.value.filter((v): v is string => typeof v === "string");
			}

			let nextDisabled: string[];
			if (currentlyEnabled) {
				// We want to disable it -> add to disabledExtensions
				const set = new Set(currentDisabled);
				set.add(extName);
				nextDisabled = Array.from(set);
			} else {
				// We want to enable it -> remove from disabledExtensions
				nextDisabled = currentDisabled.filter(
					(id) =>
						id !== extName &&
						id !== `extension-module:${extName}` &&
						id !== extPath,
				);
			}

			await ompConfigSet("disabledExtensions", JSON.stringify(nextDisabled));
			updateExtensionEnabled(extPath, !currentlyEnabled);
			toast.success(currentlyEnabled ? `已禁用扩展 ${extName}` : `已启用扩展 ${extName}`);
		} catch (err) {
			toast.error(`更新扩展状态失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setTogglingPath(null);
		}
	};

	const totalSkillsCount = catalog?.skills.length ?? 0;
	const totalExtensionsCount = catalog?.extensions.length ?? 0;

	return (
		<div className="flex h-full w-full min-w-0 bg-[var(--bg)] text-[var(--text)] select-none">
			{/* Left Column: Explorer & Lists */}
			<div className="flex w-[340px] shrink-0 flex-col border-r border-[var(--border-divider)] bg-[var(--bg-panel)]">
				{/* Header */}
				<div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-divider)] px-3">
					<div className="flex items-center gap-2">
						<Sparkles size={16} className="text-amber-400" />
						<h1 className="text-sm font-semibold text-neutral-100">技能与扩展</h1>
					</div>
					<button
						type="button"
						onClick={() => refresh(projectCwd)}
						disabled={loading}
						title="刷新技能与扩展列表"
						className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 disabled:opacity-50 transition-colors"
					>
						<RefreshCw size={14} className={clsx(loading && "animate-spin text-sky-400")} />
					</button>
				</div>

				{/* Search Box */}
				<div className="p-2.5 pb-2">
					<div className="relative flex items-center">
						<Search size={13} className="pointer-events-none absolute left-2.5 text-neutral-400" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder={activeTab === "skills" ? "搜索技能名称或描述..." : "搜索扩展名称或路径..."}
							className="h-8 w-full rounded-lg hairline bg-[var(--well-bg)] pl-8 pr-7 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-all"
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
				</div>

				{/* Tabs */}
				<div className="flex shrink-0 border-b border-[var(--border-divider)] px-2.5">
					<button
						type="button"
						onClick={() => setActiveTab("skills")}
						className={clsx(
							"flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors",
							activeTab === "skills"
								? "border-amber-500 text-amber-400"
								: "border-transparent text-neutral-400 hover:text-neutral-200",
						)}
					>
						<Sparkles size={12} />
						<span>技能</span>
						<span className="rounded-full bg-neutral-800/80 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
							{totalSkillsCount}
						</span>
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("extensions")}
						className={clsx(
							"flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors",
							activeTab === "extensions"
								? "border-indigo-500 text-indigo-400"
								: "border-transparent text-neutral-400 hover:text-neutral-200",
						)}
					>
						<Puzzle size={12} />
						<span>扩展</span>
						<span className="rounded-full bg-neutral-800/80 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
							{totalExtensionsCount}
						</span>
					</button>
				</div>

				{/* List Container */}
				<div className="flex-1 overflow-y-auto p-2">
					{loading && !catalog ? (
						<div className="flex flex-col gap-2 p-2">
							{Array.from({ length: 5 }).map((_, i) => (
								<div
									key={i}
									className="h-16 w-full animate-pulse rounded-lg bg-neutral-800/40 hairline"
								/>
							))}
						</div>
					) : error ? (
						<div className="m-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
							<div className="flex items-center gap-1.5 font-medium">
								<AlertCircle size={13} />
								<span>加载失败</span>
							</div>
							<p className="mt-1 text-neutral-400">{error}</p>
						</div>
					) : activeTab === "skills" ? (
						// Skills List
						filteredSkills.length === 0 ? (
							<div className="flex flex-col items-center justify-center p-8 text-center text-xs text-neutral-500">
								<Sparkles size={24} className="mb-2 text-neutral-600" />
								<span>{searchQuery ? "未找到匹配的技能" : "暂无可用的技能"}</span>
							</div>
						) : (
							<div className="space-y-4">
								{groupedSkills.map((group) => {
									const visibleItems = group.items.slice(0, visibleLimit);
									return (
										<div key={group.source} className="space-y-1">
											<div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium text-neutral-400">
												<span>{group.label}</span>
												<span className="text-neutral-500 font-mono">
													{group.items.length}
												</span>
											</div>
											<div className="space-y-1">
												{visibleItems.map((skill) => {
													const isSelected = skill.path === selectedSkillPath;
													return (
														<button
															key={skill.path}
															type="button"
															onClick={() => setSelectedSkill(skill.path)}
															className={clsx(
																"flex w-full flex-col items-start rounded-lg p-2.5 text-left transition-all hairline",
																isSelected
																	? "bg-[var(--bg-active-fill)] border-amber-500/30 shadow-apple-card"
																	: "bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] border-transparent",
															)}
														>
															<div className="flex w-full items-center justify-between gap-1.5">
																<span
																	className={clsx(
																		"text-xs font-semibold truncate",
																		isSelected ? "text-amber-300" : "text-neutral-200",
																	)}
																>
																	{skill.name}
																</span>
																<span
																	className={clsx(
																		"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono",
																		skill.source === "project"
																			? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
																			: "bg-neutral-800 text-neutral-400",
																	)}
																>
																	{skill.source === "project" ? "项目" : "全局"}
																</span>
															</div>
															{skill.description ? (
																<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
																	{skill.description}
																</p>
															) : (
																<p className="mt-1 text-[11px] italic text-neutral-600">
																	暂无描述
																</p>
															)}
														</button>
													);
												})}
											</div>
										</div>
									);
								})}

								{filteredSkills.length > visibleLimit && (
									<button
										type="button"
										onClick={() => setVisibleLimit((l) => l + PAGE_STEP)}
										className="flex w-full items-center justify-center rounded-lg border border-[var(--border-divider)] py-2 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
									>
										展开更多 (剩余 {filteredSkills.length - visibleLimit} 个)
									</button>
								)}
							</div>
						)
					) : (
						// Extensions List
						filteredExtensions.length === 0 ? (
							<div className="flex flex-col items-center justify-center p-8 text-center text-xs text-neutral-500">
								<Puzzle size={24} className="mb-2 text-neutral-600" />
								<span>{searchQuery ? "未找到匹配的扩展" : "暂无可用的扩展"}</span>
							</div>
						) : (
							<div className="space-y-4">
								{groupedExtensions.map((group) => {
									const visibleItems = group.items.slice(0, visibleLimit);
									return (
										<div key={group.source} className="space-y-1">
											<div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium text-neutral-400">
												<span>{group.label}</span>
												<span className="text-neutral-500 font-mono">
													{group.items.length}
												</span>
											</div>
											<div className="space-y-1">
												{visibleItems.map((ext) => {
													const isSelected = ext.path === selectedExtensionPath;
													const isToggling = togglingPath === ext.path;
													return (
														<div
															key={ext.path}
															onClick={() => setSelectedExtension(ext.path)}
															className={clsx(
																"flex w-full cursor-pointer items-center justify-between rounded-lg p-2.5 transition-all hairline",
																isSelected
																	? "bg-[var(--bg-active-fill)] border-indigo-500/30 shadow-apple-card"
																	: "bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] border-transparent",
															)}
														>
															<div className="min-w-0 flex-1 pr-2">
																<div className="flex items-center gap-1.5">
																	<span
																		className={clsx(
																			"text-xs font-semibold truncate",
																			isSelected ? "text-indigo-300" : "text-neutral-200",
																		)}
																	>
																		{ext.name}
																	</span>
																	<span
																		className={clsx(
																			"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono",
																			ext.source === "project"
																				? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
																				: "bg-neutral-800 text-neutral-400",
																		)}
																	>
																		{ext.source === "project" ? "项目" : "全局"}
																	</span>
																</div>
																<p className="mt-1 truncate text-[11px] font-mono text-neutral-500" title={ext.path}>
																	{ext.path}
																</p>
															</div>
															{/* Toggle switch */}
															<button
																type="button"
																disabled={isToggling}
																onClick={(e) => {
																	e.stopPropagation();
																	handleToggleExtension(ext.name, ext.path, ext.enabled);
																}}
																title={ext.enabled ? "点击禁用扩展" : "点击启用扩展"}
																className={clsx(
																	"relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none",
																	ext.enabled ? "bg-emerald-600" : "bg-neutral-700",
																	isToggling && "opacity-50 cursor-wait",
																)}
															>
																<span
																	className={clsx(
																		"inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
																		ext.enabled ? "translate-x-4.5" : "translate-x-1",
																	)}
																/>
															</button>
														</div>
													);
												})}
											</div>
										</div>
									);
								})}

								{filteredExtensions.length > visibleLimit && (
									<button
										type="button"
										onClick={() => setVisibleLimit((l) => l + PAGE_STEP)}
										className="flex w-full items-center justify-center rounded-lg border border-[var(--border-divider)] py-2 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
									>
										展开更多 (剩余 {filteredExtensions.length - visibleLimit} 个)
									</button>
								)}
							</div>
						)
					)}
				</div>
			</div>

			{/* Right Column: Detail Pane */}
			<div className="flex flex-1 min-w-0 flex-col bg-[var(--bg)]">
				{activeTab === "skills" ? (
					activeSkill ? (
						<div className="flex h-full flex-col min-w-0">
							{/* Skill Detail Header */}
							<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-divider)] bg-[var(--bg-panel)] px-6 py-3.5">
								<div className="min-w-0 flex-1 pr-4">
									<div className="flex items-center gap-2">
										<h2
											className="min-w-0 text-base font-semibold text-neutral-100 truncate"
											title={activeSkill.name}
										>
											{activeSkill.name}
										</h2>
										<span
											className={clsx(
												"rounded px-2 py-0.5 text-xs font-mono shrink-0",
												activeSkill.source === "project"
													? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
													: "bg-neutral-800 text-neutral-400",
											)}
										>
											{activeSkill.source === "project" ? "当前项目" : "全局"}
										</span>
									</div>
									<div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
										<span className="shrink-0 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-px font-mono">
											/skill:{activeSkill.name}
										</span>
										<span
											className="min-w-0 truncate font-mono text-neutral-500"
											title={activeSkill.path}
										>
											{activeSkill.path}
										</span>
									</div>
								</div>

								{/* Action Buttons */}
								<div className="flex items-center gap-2 shrink-0">
									<button
										type="button"
										onClick={() => handleInsertIntoComposer(activeSkill.name)}
										disabled={!selectedSessionId}
										title={
											selectedSessionId
												? `在当前会话插入 /skill:${activeSkill.name}`
												: "请先在侧边栏选择一个会话"
										}
										className={clsx(
											"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium active:scale-95 transition-all shadow-apple-card hairline",
											selectedSessionId
												? "bg-amber-600/90 hover:bg-amber-500 text-white"
												: "bg-neutral-800 text-neutral-500 cursor-not-allowed opacity-50",
										)}
									>
										<MessageSquarePlus size={13} />
										<span>在当前会话中使用</span>
									</button>

									<button
										type="button"
										onClick={() => handleRevealInFinder(activeSkill.dir || activeSkill.path)}
										title="在访达中显示技能目录"
										className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all"
									>
										<FolderOpen size={13} />
										<span>在访达中显示</span>
									</button>
								</div>
							</div>

							{/* Markdown Document Body */}
							<div className="flex-1 overflow-y-auto p-6">
								{detailLoading ? (
									<div className="space-y-3">
										<div className="h-6 w-1/3 animate-pulse rounded bg-neutral-800/60" />
										<div className="h-4 w-full animate-pulse rounded bg-neutral-800/40" />
										<div className="h-4 w-5/6 animate-pulse rounded bg-neutral-800/40" />
										<div className="h-4 w-2/3 animate-pulse rounded bg-neutral-800/40" />
									</div>
								) : detailError ? (
									<div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
										<div className="flex items-center gap-2 font-medium">
											<AlertCircle size={14} />
											<span>读取技能文档失败</span>
										</div>
										<p className="mt-1 text-neutral-400">{detailError}</p>
									</div>
								) : detailContent ? (
									<div className="max-w-4xl">
										<Markdown text={detailContent} />
									</div>
								) : (
									<div className="flex h-32 items-center justify-center text-xs text-neutral-500">
										文档内容为空
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="flex h-full flex-col items-center justify-center text-center p-8 text-neutral-500">
							<Sparkles size={36} className="mb-3 text-neutral-600" />
							<p className="text-sm font-medium text-neutral-400">选择一个技能以查看详细信息与文档</p>
							<p className="mt-1 text-xs text-neutral-600">
								可以在会话输入框通过 /skill:&lt;name&gt; 快速调用
							</p>
						</div>
					)
				) : activeExtension ? (
					// Extension Detail Pane
					<div className="flex h-full flex-col min-w-0">
						<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-divider)] bg-[var(--bg-panel)] px-6 py-3.5">
							<div className="min-w-0 flex-1 pr-4">
								<div className="flex items-center gap-2">
									<h2 className="text-base font-semibold text-neutral-100 truncate">
										{activeExtension.name}
									</h2>
									<span
										className={clsx(
											"rounded px-2 py-0.5 text-xs font-mono shrink-0",
											activeExtension.source === "project"
												? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
												: "bg-neutral-800 text-neutral-400",
										)}
									>
										{activeExtension.source === "project" ? "当前项目" : "全局"}
									</span>
									<span
										className={clsx(
											"rounded px-2 py-0.5 text-xs font-mono shrink-0 flex items-center gap-1",
											activeExtension.enabled
												? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
												: "bg-neutral-800 text-neutral-400 border border-neutral-700",
										)}
									>
										<Power size={11} />
										<span>{activeExtension.enabled ? "已启用" : "已禁用"}</span>
									</span>
								</div>
								<p
									className="mt-1 text-xs text-neutral-500 font-mono truncate"
									title={activeExtension.path}
								>
									{activeExtension.path}
								</p>
							</div>

							<div className="flex items-center gap-2 shrink-0">
								<button
									type="button"
									disabled={togglingPath === activeExtension.path}
									onClick={() =>
										handleToggleExtension(
											activeExtension.name,
											activeExtension.path,
											activeExtension.enabled,
										)
									}
									className={clsx(
										"flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium active:scale-95 transition-all shadow-apple-card hairline",
										activeExtension.enabled
											? "bg-neutral-800 hover:bg-neutral-700 text-neutral-200"
											: "bg-emerald-600 hover:bg-emerald-500 text-white",
									)}
								>
									<Power size={13} />
									<span>{activeExtension.enabled ? "禁用扩展" : "启用扩展"}</span>
								</button>

								<button
									type="button"
									onClick={() => handleRevealInFinder(activeExtension.path)}
									title="在访达中显示扩展文件"
									className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 transition-all"
								>
									<FolderOpen size={13} />
									<span>在访达中显示</span>
								</button>
							</div>
						</div>

						<div className="p-6 max-w-2xl space-y-4">
							<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-4 shadow-apple-card">
								<h3 className="text-xs font-semibold text-neutral-300">扩展信息</h3>
								<dl className="mt-3 space-y-2 text-xs">
									<div className="flex">
										<dt className="w-20 text-neutral-500">扩展标识</dt>
										<dd className="font-mono text-neutral-200">{activeExtension.name}</dd>
									</div>
									<div className="flex">
										<dt className="w-20 text-neutral-500">当前状态</dt>
										<dd>
											{activeExtension.enabled ? (
												<span className="text-emerald-400 font-medium">已启用 (将在会话启动时加载)</span>
											) : (
												<span className="text-neutral-400">已禁用 (在 disabledExtensions 配置中)</span>
											)}
										</dd>
									</div>
									<div className="flex">
										<dt className="w-20 text-neutral-500">安装位置</dt>
										<dd className="flex-1 font-mono text-neutral-400 break-all">
											{activeExtension.path}
										</dd>
									</div>
								</dl>
							</div>

							<div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-xs text-neutral-400 leading-relaxed">
								<p className="font-medium text-sky-300 mb-1">关于 OMP 扩展机制</p>
								<p>
									扩展通过 OMP 原生扩展系统运行，能够介入工具调用、拦截消息流并增强模型能力。
									启用/禁用状态通过 OMP 配置项 <code className="rounded bg-sky-950/60 px-1 py-0.5 text-sky-200 font-mono">disabledExtensions</code> 实时同步。
								</p>
							</div>
						</div>
					</div>
				) : (
					<div className="flex h-full flex-col items-center justify-center text-center p-8 text-neutral-500">
						<Puzzle size={36} className="mb-3 text-neutral-600" />
						<p className="text-sm font-medium text-neutral-400">选择一个扩展以查看详情或切换启用状态</p>
					</div>
				)}
			</div>
		</div>
	);
}
