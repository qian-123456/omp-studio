/**
 * Settings shell: nav sidebar + search, deep-link focus flash and routing of
 * the active nav id to its section component (see `sections/index.ts`).
 */
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { FIELD_REGISTRY, findMatchingField } from "./fieldRegistry";
import { NAV_GROUPS, ompCategoryOf, ompSectionId, sectionSearchTerms } from "./navigation";
import { OmpConfigSection } from "./OmpConfigSection";
import { useOmpConfigStore } from "./ompConfigStore";
import { ompDesktopCategoryFor } from "./ompDesktopCategories";
import { SECTION_COMPONENTS } from "./sections";
import { SettingsNavContext, type SettingsNavValue } from "./settingsNav";
import { useSettings } from "./store";

interface SettingsPageProps {
	onClose?: () => void;
	initialSection?: string;
}

/** Elements that run their own Cmd+F (editors, terminals). */
const OWN_FIND_SELECTOR = ".cm-editor, .monaco-editor, .xterm, [data-own-find]";

export function SettingsPage({ onClose, initialSection }: SettingsPageProps = {}) {
	const loadSettings = useSettings((s) => s.load);
	const storeError = useSettings((s) => s.error);
	const closeSettings = useUi((s) => s.closeSettings);
	const pendingSection = useUi((s) => s.settingsSection);
	const pendingFocus = useUi((s) => s.settingsFocus);
	const loadOmpConfig = useOmpConfigStore((s) => s.load);
	const ompEntries = useOmpConfigStore((s) => s.entries);

	const [activeSection, setActiveSection] = useState<string>(initialSection ?? "general");
	// OMP category's schema sub-group filter (controlled into OmpConfigSection
	// so deep links can force it back to "all").
	const [ompGroupName, setOmpGroupName] = useState<string | null>(null);
	// Pending deep-link focus: scrolls the row into view and briefly flashes it.
	const [focusFlash, setFocusFlash] = useState<{ key: string; n: number } | null>(null);
	const [navQuery, setNavQuery] = useState("");
	const contentRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	const ompCategory = ompCategoryOf(activeSection);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	// Switching sections always lands at the top of the new section.
	// biome-ignore lint/correctness/useExhaustiveDependencies: activeSection is the trigger
	useEffect(() => {
		contentRef.current?.scrollTo({ top: 0 });
		setOmpGroupName(null);
	}, [activeSection]);

	// Load OMP entries eagerly while searching so the nav index covers them.
	useEffect(() => {
		if (activeSection.startsWith("omp-") || navQuery.trim()) void loadOmpConfig();
	}, [activeSection, navQuery, loadOmpConfig]);

	const handleBack = useCallback(() => (onClose ? onClose() : closeSettings()), [onClose, closeSettings]);
	useEscapeKey(handleBack);

	// Cmd/Ctrl+F and Cmd/Ctrl+K focus the settings search. Capture phase runs
	// before the global sidebar Cmd+F handler, which skips prevented events.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || isComposing(e)) return;
			const key = e.key.toLowerCase();
			if (key !== "f" && key !== "k") return;
			if ((e.target as HTMLElement | null)?.closest?.(OWN_FIND_SELECTOR)) return;
			e.preventDefault();
			searchRef.current?.focus();
			searchRef.current?.select();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

	// Jump to the section requested via openSettings(section, {focusKey}).
	useEffect(() => {
		if (!pendingSection && !pendingFocus) return;
		let target = pendingSection;
		const isOmpKey =
			pendingFocus && target?.startsWith("omp-") && !FIELD_REGISTRY.some((f) => f.id === pendingFocus);
		if (pendingFocus && isOmpKey) {
			// OMP config rows carry data-omp-key; if the key belongs to another
			// desktop category, switch there and clear nav search/group filter so
			// the row is actually rendered.
			target = `omp-${ompDesktopCategoryFor(pendingFocus).id}`;
			setNavQuery("");
			setOmpGroupName(null);
		}
		if (target) setActiveSection(target);
		if (pendingFocus) setFocusFlash((f) => ({ key: pendingFocus, n: (f?.n ?? 0) + 1 }));
		useUi.setState({ settingsSection: null, settingsFocus: null });
	}, [pendingSection, pendingFocus]);

	// Scroll the focused row into view and briefly highlight it. Retries for
	// ~3s because OmpConfigSection rows render after `omp config list` returns.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the section mounts
	useEffect(() => {
		if (!focusFlash || !contentRef.current) return;
		const selector = `[data-field-id="${CSS.escape(focusFlash.key)}"],[data-omp-key="${CSS.escape(focusFlash.key)}"]`;
		const tryScroll = () => {
			const el = contentRef.current?.querySelector<HTMLElement>(selector);
			if (!el) return false;
			el.scrollIntoView({ behavior: "smooth", block: "center" });
			el.style.transition = "background-color 0.9s ease";
			el.style.backgroundColor = "var(--ghost-hover, color-mix(in oklab, currentColor 6%, transparent))";
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
			if (tryScroll()) clearInterval(t);
		}, 160);
		const stop = setTimeout(() => clearInterval(t), 3000);
		return () => {
			clearInterval(t);
			clearTimeout(stop);
		};
	}, [focusFlash, activeSection]);

	// Nav search index: section label + keywords + OMP keys/roles/custom terms.
	const navQueryL = navQuery.trim().toLowerCase();
	const navGroupsMatched = useMemo(
		() =>
			NAV_GROUPS.map((group) => ({
				...group,
				items: group.items
					.map((sec) => {
						const hits = navQueryL
							? sectionSearchTerms(sec.id, ompEntries).filter((t) => t.toLowerCase().includes(navQueryL))
							: [];
						const hit = !navQueryL || sec.label.toLowerCase().includes(navQueryL) || hits.length > 0;
						return { ...sec, hit, hits: [...new Set(hits)] };
					})
					.filter((s) => s.hit),
			})).filter((g) => g.items.length > 0),
		[navQueryL, ompEntries],
	);
	const allMatchedItems = useMemo(() => navGroupsMatched.flatMap((g) => g.items), [navGroupsMatched]);

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
		const el = contentRef.current.querySelector<HTMLElement>(`[data-field-id="${match.id}"]`);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "nearest" });
		el.classList.add("ring-2", "ring-[var(--accent)]", "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]");
		const t = setTimeout(() => {
			el.classList.remove("ring-2", "ring-[var(--accent)]", "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]");
		}, 1800);
		return () => clearTimeout(t);
	}, [activeSection, navQueryL]);

	/** Arrow keys move between visible nav items (and activate them). */
	const moveNav = (fromId: string, delta: number) => {
		const idx = allMatchedItems.findIndex((s) => s.id === fromId);
		const next = allMatchedItems[idx + delta];
		if (!next) return;
		setActiveSection(next.id);
		navRef.current?.querySelector<HTMLButtonElement>(`[data-nav-id="${CSS.escape(next.id)}"]`)?.focus();
	};

	const navValue = useMemo<SettingsNavValue>(
		() => ({ query: navQuery.trim(), navigate: setActiveSection }),
		[navQuery],
	);

	const ActiveSection = SECTION_COMPONENTS[activeSection];
	const noMatches = navQueryL !== "" && allMatchedItems.length === 0;

	return (
		<div className="flex h-full min-h-0 overflow-hidden bg-transparent text-neutral-200">
			{/* Left Navigation Bar */}
			<div className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-[var(--border-divider)] vibrancy-chrome p-2.5">
				<div className="mb-2 flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1.5 focus-within:ring-1 focus-within:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]">
					<Search className="h-3 w-3 shrink-0 text-neutral-500" />
					<input
						ref={searchRef}
						value={navQuery}
						aria-label="搜索设置"
						onChange={(e) => setNavQuery(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								e.stopPropagation();
								if (navQuery) setNavQuery("");
								else e.currentTarget.blur();
							} else if (e.key === "ArrowDown" || e.key === "Enter") {
								e.preventDefault();
								const first = allMatchedItems[0];
								if (first) {
									setActiveSection(first.id);
									navRef.current
										?.querySelector<HTMLButtonElement>(`[data-nav-id="${CSS.escape(first.id)}"]`)
										?.focus();
								}
							}
						}}
						placeholder="搜索设置（⌘F）"
						className="w-full bg-transparent text-[11px] text-neutral-200 outline-none placeholder:text-neutral-500"
					/>
					{navQuery && (
						<button
							type="button"
							aria-label="清除搜索"
							title="清除搜索（Esc）"
							onClick={() => {
								setNavQuery("");
								searchRef.current?.focus();
							}}
							className="shrink-0 rounded p-0.5 text-neutral-500 hover:text-neutral-300 active:scale-95 transition-all"
						>
							<X className="h-3 w-3" />
						</button>
					)}
				</div>
				<nav ref={navRef} aria-label="设置分类" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
					{noMatches ? (
						<div className="px-2 py-3 text-center text-[11px] leading-4 text-neutral-500">
							没有匹配「{navQuery.trim()}」的设置项
						</div>
					) : (
						navGroupsMatched.map((group) => (
							<div key={group.title} className="space-y-0.5">
								<div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold text-neutral-500">
									{group.title}
								</div>
								{group.items.map((sec) => {
									const Icon = sec.icon;
									const isActive = activeSection === sec.id;
									const hint = sec.hits.length > 0 ? sec.hits.slice(0, 2).join(" · ") : null;
									return (
										<button
											key={sec.id}
											type="button"
											data-nav-id={sec.id}
											aria-current={isActive ? "page" : undefined}
											onClick={() => setActiveSection(sec.id)}
											onKeyDown={(e) => {
												if (e.key === "ArrowDown" || e.key === "ArrowUp") {
													e.preventDefault();
													moveNav(sec.id, e.key === "ArrowDown" ? 1 : -1);
												}
											}}
											className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)] active:scale-[0.98] ${
												isActive
													? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text)] font-semibold shadow-xs"
													: "text-neutral-400 hover:bg-[var(--bg-active-fill)] hover:text-neutral-200"
											}`}
										>
											<Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-[var(--accent)]" : ""}`} />
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
				<div className="mx-auto max-w-3xl space-y-8">
					{storeError && (
						<div className="rounded-xl border border-rose-800/50 bg-rose-950/20 p-3 text-xs text-rose-300">
							保存失败: {storeError}
						</div>
					)}
					{noMatches ? (
						<div className="py-16 text-center text-xs text-neutral-500">
							没有找到与「{navQuery.trim()}」相关的设置。试试换个关键词，或按 Esc 清除搜索。
						</div>
					) : (
						<SettingsNavContext.Provider value={navValue}>
							{ActiveSection && <ActiveSection />}
							{ompCategory !== null && (
								<OmpConfigSection
									activeTab={ompCategory}
									onTabChange={(tab) => setActiveSection(ompSectionId(tab))}
									query={navValue.query}
									activeGroupName={ompGroupName}
									onGroupChange={setOmpGroupName}
								/>
							)}
						</SettingsNavContext.Provider>
					)}
				</div>
			</div>
		</div>
	);
}
