/**
 * Settings shell: nav sidebar + ranked search, deep-link focus flash and routing of
 * the active nav id to its section component (see `sections/index.ts`).
 */
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isComposing } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { useSettingsEscape } from "./nestedModal";
import { FIELD_REGISTRY, findMatchingField } from "./fieldRegistry";
import {
	NAV_GROUPS,
	buildSearchIndex,
	navGroupTitle,
	navItemLabel,
	navItem,
	searchSection,
	type NavItem,
} from "./navigation";
import { OMP_CONFIG_META, ompConfigTitle } from "./ompConfigMeta";
import { useOmpConfigStore } from "./ompConfigStore";
import { isDesktopRelevant, ompSearchTerms, ompSectionFor } from "./ompPlacement";
import { SECTION_COMPONENTS } from "./sections";
import { SettingsNavContext, type SettingsNavValue } from "./settingsNav";
import { useSettings } from "./store";
import { Notice } from "../../components/Notice";
import { useT } from "../../stores/language";

interface SettingsPageProps {
	onClose?: () => void;
	initialSection?: string;
}

/** Elements that run their own Cmd+F (editors, terminals). */
const OWN_FIND_SELECTOR = ".cm-editor, .monaco-editor, .xterm, [data-own-find]";

const FLASH_CLASSES = ["ring-2", "ring-[var(--accent)]", "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"];

/** Unknown nav ids fall back to the general page. */
function resolveSection(id: string | null | undefined): string {
	return id && navItem(id) ? id : "general";
}

type NavEntry = NavItem & { hint: string | null };

export function SettingsPage({ onClose, initialSection }: SettingsPageProps = {}) {
	const { t, locale } = useT();
	const loadSettings = useSettings((s) => s.load);
	const storeError = useSettings((s) => s.error);
	const closeSettings = useUi((s) => s.closeSettings);
	const pendingSection = useUi((s) => s.settingsSection);
	const pendingFocus = useUi((s) => s.settingsFocus);
	const pendingRequest = useUi((s) => s.settingsRequest);
	const loadOmpConfig = useOmpConfigStore((s) => s.load);
	const ompEntries = useOmpConfigStore((s) => s.entries);

	const [activeSection, setActiveSection] = useState<string>(resolveSection(initialSection));
	// Pending deep-link focus: scrolls the row into view and briefly flashes it.
	const [focusFlash, setFocusFlash] = useState<{ key: string; n: number; section: string } | null>(null);
	const [navQuery, setNavQuery] = useState("");
	const contentRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	// Eager omp load: nav counts, search index and the omp pages all read this store.
	useEffect(() => {
		void loadOmpConfig();
	}, [loadOmpConfig]);

	// Switching sections always lands at the top of the new section.
	// biome-ignore lint/correctness/useExhaustiveDependencies: activeSection is the trigger
	useEffect(() => {
		contentRef.current?.scrollTo({ top: 0 });
	}, [activeSection]);

	// Keep the active nav item visible (deep links, search jumps, arrow keys).
	useEffect(() => {
		navRef.current
			?.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(activeSection)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeSection]);

	const handleBack = useCallback(() => (onClose ? onClose() : closeSettings()), [onClose, closeSettings]);
	useSettingsEscape(handleBack);

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

	// Apply a pending deep-link request exactly once, during render. The old
	// version consumed it in a passive effect that also cleared the store —
	// any intervening store write (a second openSettings, a close, or a
	// remount after the Suspense reveal) could drop the target and land on
	// "general". Applying during render leaves no such window.
	const [appliedRequest, setAppliedRequest] = useState(-1);
	if (pendingRequest !== appliedRequest) {
		setAppliedRequest(pendingRequest);
		let target = pendingSection;
		const isOmpKey =
			pendingFocus &&
			!FIELD_REGISTRY.some((f) => f.id === pendingFocus) &&
			OMP_CONFIG_META[pendingFocus] !== undefined &&
			isDesktopRelevant(pendingFocus);
		if (pendingFocus && isOmpKey) {
			// OMP config rows carry data-omp-key; the key's placement decides the page,
			// and any nav search is cleared so the row is actually rendered.
			target = ompSectionFor(pendingFocus).page;
			setNavQuery("");
		}
		if (target) setActiveSection(resolveSection(target));
		if (pendingFocus) {
			setFocusFlash({ key: pendingFocus, n: pendingRequest, section: target ? resolveSection(target) : activeSection });
		}
	}

	// A deep-link target only belongs to the section it jumped to; leaving that
	// section drops it so re-entering never replays an old jump.
	useEffect(() => {
		if (focusFlash && focusFlash.section !== activeSection) setFocusFlash(null);
	}, [focusFlash, activeSection]);

	// Mark the request consumed without clearing its target, so a remount
	// (Suspense re-reveal, HMR) re-applies the same section instead of
	// falling back to "general". The next openSettings/closeSettings
	// overwrites it.
	useEffect(() => {
		if (useUi.getState().settingsPending) {
			useUi.setState({ settingsPending: false });
		}
	}, [pendingRequest]);

	// Scroll the focused row into view and briefly highlight it. Retries for
	// ~3s because omp rows render after `omp config list` returns.
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

	// Ranked nav search: label hit > title/name > keyword/English label/key > description.
	const navQueryL = navQuery.trim().toLowerCase();
	const searchIndex = useMemo(() => buildSearchIndex(ompEntries, locale), [ompEntries, locale]);
	const navGroupsMatched = useMemo<{ id: string; title: string; items: NavEntry[] }[]>(() => {
		if (!navQueryL) {
			return NAV_GROUPS.map((g) => ({ id: g.id, title: navGroupTitle(t, g), items: g.items.map((i) => ({ ...i, hint: null })) }));
		}
		const ranked = NAV_GROUPS.flatMap((g) => g.items)
			.map((item, order) => ({ item, order, ...searchSection(searchIndex, item, navQueryL) }))
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score || a.order - b.order)
			.map<NavEntry>((r) => ({ ...r.item, hint: r.names.length > 0 ? r.names.join(" · ") : null }));
		return ranked.length > 0 ? [{ id: "searchResults", title: t("settings.searchResults"), items: ranked }] : [];
	}, [navQueryL, searchIndex, locale]); // `t` is derived from `locale`
	const allMatchedItems = useMemo(() => navGroupsMatched.flatMap((g) => g.items), [navGroupsMatched]);

	// Jump to the best match when the query changes; keep the active page inside the result set.
	const jumpedQuery = useRef("");
	useEffect(() => {
		if (!navQueryL) {
			jumpedQuery.current = "";
			return;
		}
		const first = allMatchedItems[0];
		if (!first) return;
		if (jumpedQuery.current !== navQueryL || !allMatchedItems.some((s) => s.id === activeSection)) {
			jumpedQuery.current = navQueryL;
			if (first.id !== activeSection) setActiveSection(first.id);
		}
	}, [allMatchedItems, navQueryL, activeSection]);

	// In-page scroll to and briefly highlight the first matching row (native field or omp key).
	// biome-ignore lint/correctness/useExhaustiveDependencies: ompEntries re-runs once omp rows exist
	useEffect(() => {
		const root = contentRef.current;
		if (!navQueryL || !root) return;
		const find = (): HTMLElement | null => {
			const field = findMatchingField(activeSection, navQueryL, locale);
			const native = field ? root.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(field.id)}"]`) : null;
			if (native) return native;
			const rows = [...root.querySelectorAll<HTMLElement>("[data-omp-key]")];
			const byTitle = rows.find((el) => {
				const key = el.dataset.ompKey ?? "";
				return (
					ompConfigTitle(key, locale).toLowerCase().includes(navQueryL) ||
					ompConfigTitle(key, "zh-CN").toLowerCase().includes(navQueryL)
				);
			});
			if (byTitle) return byTitle;
			return (
				rows.find((el) => ompSearchTerms(el.dataset.ompKey ?? "", locale).some((t) => t.toLowerCase().includes(navQueryL))) ??
				null
			);
		};
		let flashed: HTMLElement | null = null;
		let flashTimer = 0;
		const tryFlash = () => {
			const el = find();
			if (!el) return false;
			el.scrollIntoView({ behavior: "smooth", block: "nearest" });
			el.classList.add(...FLASH_CLASSES);
			flashed = el;
			flashTimer = window.setTimeout(() => el.classList.remove(...FLASH_CLASSES), 1800);
			return true;
		};
		const found = tryFlash();
		const poll = found
			? 0
			: window.setInterval(() => {
					if (tryFlash()) clearInterval(poll);
				}, 160);
		const stop = window.setTimeout(() => clearInterval(poll), 3000);
		return () => {
			clearInterval(poll);
			clearTimeout(stop);
			clearTimeout(flashTimer);
			flashed?.classList.remove(...FLASH_CLASSES);
		};
	}, [activeSection, navQueryL, ompEntries.length]);

	/** Arrow keys move between visible nav items (and activate them). */
	const moveNav = (fromId: string, delta: number) => {
		const idx = allMatchedItems.findIndex((s) => s.id === fromId);
		const next = allMatchedItems[idx + delta];
		if (!next) return;
		setActiveSection(next.id);
		navRef.current?.querySelector<HTMLButtonElement>(`[data-nav-id="${CSS.escape(next.id)}"]`)?.focus();
	};

	const focusKey = focusFlash?.key ?? null;
	const focusRequest = focusFlash?.n ?? 0;
	const navValue = useMemo<SettingsNavValue>(
		() => ({ query: navQuery.trim(), navigate: (id) => setActiveSection(resolveSection(id)), focusKey, focusRequest }),
		[navQuery, focusKey, focusRequest],
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
						aria-label={t("common.search")}
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
						placeholder={t("settings.searchPlaceholder")}
						className="w-full bg-transparent text-xs text-neutral-200 outline-none placeholder:text-neutral-500"
					/>
					{navQuery && (
						<button
							type="button"
							aria-label={t("common.reset")}
							title={`${t("common.reset")}（Esc）`}
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
				<nav ref={navRef} aria-label={t("settings.categories")} className="-mr-2.5 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2.5">
					{noMatches ? (
						<div className="px-2 py-3 text-center text-xs leading-4 text-neutral-500">
							{t("settings.noMatchingCategories", { query: navQuery.trim() })}
						</div>
					) : (
						navGroupsMatched.map((group) => (
							<div key={group.id} className="space-y-0.5">
								<div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold text-neutral-500">
									{group.title}
								</div>
								{group.items.map((sec) => {
									const Icon = sec.icon;
									const isActive = activeSection === sec.id;
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
												<span className="block truncate">{navItemLabel(t, sec)}</span>
												{sec.hint && (
													<span className="block truncate text-[11px] font-normal text-neutral-500">
														{sec.hint}
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
						<Notice tone="danger" title={t("settings.saveFailed")}>
							<span className="select-text break-all">{storeError}</span>
						</Notice>
					)}
					{noMatches ? (
						<div className="py-16 text-center text-xs text-neutral-500">
							{t("settings.noMatchingSettings", { query: navQuery.trim() })}
						</div>
					) : (
						<SettingsNavContext.Provider value={navValue}>
							{ActiveSection && <ActiveSection />}
						</SettingsNavContext.Provider>
					)}
				</div>
			</div>
		</div>
	);
}
