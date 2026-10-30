/**
 * Right panel header: one row of Chrome-style tabs for every open panel tab.
 * While the "terminal" panel tab is active it expands inline into one tab per
 * visible terminal instance (终端 1 / 终端 2 …), so there is never a second
 * header row. Tabs shrink equally; those that don't fit collapse into a
 * `+N` overflow menu (the active tab always stays inline). The `+` button
 * sits right after the tabs and opens the feature menu.
 */
import clsx from "clsx";
import {
	Check,
	ChevronDown,
	Coins,
	FileText,
	Cpu,
	Folder,
	GitBranch,
	MessageSquare,
	Minus,
	NotebookPen,
	PanelRightClose,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../stores/language";
import { useDrawerStore } from "../features/terminal/drawerStore";
import {
	STATUS_DOT,
	STATUS_LABEL,
	addTerminalTab,
	closeTerminalTab,
	detachTerminalTab,
} from "../features/terminal/terminalTabs";
import { type RightTab, useUi } from "../stores/ui";
import { FloatingLayer } from "./FloatingLayer";
import { sessionDisplayName } from "../lib/sessionName";
import { basename } from "../lib/paths";
import { openNewSideChat, isBlankTab, resolveActiveTab, useSideChatView } from "../features/sidechat/viewStore";
import { sideChatTitle } from "../features/sidechat/sideChatTitle";
import { SIDE_CHAT_TAB_ACTIONS } from "../features/sidechat/sideChatActions";
import { visibleSideChatActions } from "../features/sidechat/handbackLogic";
import { useDisplayPrefs } from "../stores/displayPrefs";
import { useFilePreview } from "../stores/filePreview";
import { useComposer } from "../stores/composer";
import { useSessions } from "../stores/sessions";
import {
	MAX_TAB_WIDTH,
	MIN_TAB_WIDTH,
	MORE_BTN_FALLBACK_WIDTH,
	PLUS_BTN_WIDTH,
	TAB_GAP,
	tabRowCapacity,
	visibleTabs,
} from "./rightPanelTabs";

interface RightPanelHeaderProps {
	activeTab: RightTab;
	tabBadges: Record<RightTab, number>;
}

type IconType = React.ComponentType<{ size?: number; className?: string }>;

const PRIMARY_TABS: { id: RightTab; icon: IconType; iconColor: string }[] = [
	{ id: "sidechat", icon: MessageSquare, iconColor: "text-sky-400" },
	{ id: "explorer", icon: Folder, iconColor: "text-amber-400" },
	{ id: "git", icon: GitBranch, iconColor: "text-orange-400" },
	{ id: "services", icon: Cpu, iconColor: "text-purple-400" },
	{ id: "heatmap", icon: Coins, iconColor: "text-amber-400" },
	{ id: "terminal", icon: SquareTerminal, iconColor: "text-emerald-400" },
	{ id: "plan", icon: NotebookPen, iconColor: "text-amber-400" },
	{ id: "files", icon: FileText, iconColor: "text-sky-400" },
];

/** One rendered Chrome tab: a panel tab, or a terminal instance of the active terminal panel tab. */
interface HeaderTab {
	key: string;
	label: string;
	title: string;
	lead: React.ReactNode;
	badge: number;
	active: boolean;
	activate(): void;
	close(): void;
	/** Terminal instances only: fold into a background service. */
	detach?: () => void;
	/** Right-click menu entries (side-chat tabs). */
	menu?: { key: string; label: string; run: () => void | Promise<void> }[];
}

export function RightPanelHeader({ activeTab, tabBadges }: RightPanelHeaderProps) {
	const { t } = useT();
	const tabLabel = (id: RightTab): string => t(`rightPanel.${id}`);
	const openRightTabs = useUi((s) => s.openRightTabs);
	const setRightTab = useUi((s) => s.setRightTab);
	const closeRightTab = useUi((s) => s.closeRightTab);
	const toggleRight = useUi((s) => s.toggleRight);
	const drawerTabs = useDrawerStore((s) => s.tabs);
	const activeTerminalId = useDrawerStore((s) => s.activeTabId);

	const [menuOpen, setMenuOpen] = useState(false);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const plusBtnRef = useRef<HTMLButtonElement>(null);
	const moreBtnRef = useRef<HTMLButtonElement>(null);
	const stripRef = useRef<HTMLDivElement>(null);
	const [stripWidth, setStripWidth] = useState(0);
	const [moreWidth, setMoreWidth] = useState(MORE_BTN_FALLBACK_WIDTH);
	const [hoveredTab, setHoveredTab] = useState<string | null>(null);
	const [tabMenu, setTabMenu] = useState<{ x: number; y: number; items: NonNullable<HeaderTab["menu"]> } | null>(null);

	// Measure the flex-1 strip that hosts [tabs, '+N', '+']. Its width is set
	// by the header flex layout, not by the tabs inside it — measuring the
	// shrink-to-fit tablist instead would feed capacity back into itself.
	useLayoutEffect(() => {
		const el = stripRef.current;
		if (!el) return;
		setStripWidth(el.clientWidth);
		const ro = new ResizeObserver(() => setStripWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const selectedId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const parentTabs = useSideChatView((s) => (selectedId ? s.openTabs[selectedId] : undefined));
	const storedSideTab = useSideChatView((s) => (selectedId ? s.openChild[selectedId] : undefined));
	const activeSideTab = resolveActiveTab(parentTabs, storedSideTab);
	const handbackMode = useDisplayPrefs((s) => s.sideChatHandback);
	const visibleTerminals = drawerTabs.filter((t) => !t.detached);
	const fileTabs = useFilePreview((s) => s.tabs);
	// A group whose instances are gone (session switched to one without side
	// chats, files closed elsewhere) must not linger as an empty ghost tab.
	const hasSideChats = !!parentTabs?.length;
	const hasFiles = fileTabs.length > 0;
	const sidechatOpen = openRightTabs.includes("sidechat");
	const filesOpen = openRightTabs.includes("files");
	useEffect(() => {
		if (sidechatOpen && !hasSideChats) closeRightTab("sidechat");
		if (filesOpen && !hasFiles) closeRightTab("files");
	}, [sidechatOpen, hasSideChats, filesOpen, hasFiles, closeRightTab]);
	const activeFilePath = useFilePreview((s) => s.activePath);
	// Groups with per-instance tabs stay in the strip whenever they have instances.
	const groupIds: RightTab[] = [...openRightTabs];
	if (parentTabs?.length && !groupIds.includes("sidechat")) groupIds.push("sidechat");
	if (fileTabs.length > 0 && !groupIds.includes("files")) groupIds.push("files");
	const items: HeaderTab[] = groupIds.flatMap((id): HeaderTab[] => {
		const info = PRIMARY_TABS.find((t) => t.id === id);
		if (!info) return [];
		if (id === "terminal" && activeTab === "terminal" && visibleTerminals.length > 0) {
			return visibleTerminals.map((t) => ({
				key: `terminal:${t.id}`,
				label: t.title,
				title: `${t.title} · ${STATUS_LABEL[t.status]}${t.cwd ? `\n${t.cwd}` : ""}`,
				lead: <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[t.status])} />,
				badge: 0,
				active: t.id === activeTerminalId,
				activate: () => useDrawerStore.getState().setActive(t.id),
				close: () => void closeTerminalTab(t.id),
				detach: () => detachTerminalTab(t.id),
			}));
		}
		const Icon = info.icon;
		if (id === "files") {
			// One tab per opened file; closing the last one closes the group.
			return fileTabs.map((t) => ({
				key: `files:${t.path}`,
				label: basename(t.path),
				title: t.path,
				lead: <Icon size={13} className={clsx(info.iconColor, "shrink-0")} />,
				badge: 0,
				active: id === activeTab && activeFilePath === t.path,
				activate: () => {
					useFilePreview.getState().setActive(t.path);
					setRightTab("files");
				},
				close: () => useFilePreview.getState().closeFile(t.path),
			}));
		}
		if (id === "sidechat") {
			// One tab per open side chat of the selected session; no base tab.
			if (!selectedId) return [];
			return (parentTabs ?? []).flatMap((tid): HeaderTab[] => {
				const blank = isBlankTab(tid);
				const c = blank ? undefined : sessions[tid];
				if (!blank && (!c || c.parentId !== selectedId)) return [];
				const name = c ? (sideChatTitle(tid, sessions) ?? sessionDisplayName(c)) : t("sidechat.newSideChatTitle");
				return [
					{
						key: `sidechat:${tid}`,
						label: name,
						title: name,
						lead: <Icon size={13} className={clsx(info.iconColor, "shrink-0")} />,
						badge: 0,
						active: id === activeTab && activeSideTab === tid,
						activate: () => {
							useSideChatView.getState().setOpenChild(selectedId, tid);
							setRightTab("sidechat");
						},
						close: () => {
							if (blank) useComposer.getState().clearSideChatDraft(tid);
							useSideChatView.getState().closeTab(selectedId, tid);
						},
						menu: blank
							? undefined
							: visibleSideChatActions(SIDE_CHAT_TAB_ACTIONS, handbackMode).map((a) => ({
									key: a.key,
									label: a.label,
									run: () => a.run(tid),
								})),
					},
				];
			});
		}
		return [
			{
				key: id,
				label: tabLabel(info.id),
				title: tabLabel(info.id),
				lead: <Icon size={13} className={clsx(info.iconColor, "shrink-0")} />,
				badge: tabBadges[id] ?? 0,
				active: id === activeTab,
				activate: () => setRightTab(id),
				close: () => closeRightTab(id),
			},
		];
	});

	// Capacity comes from the strip's real width minus the fixed controls:
	// '+' always; '+N' only when tabs actually overflow (see tabRowCapacity).
	const capacity = stripWidth > 0 ? tabRowCapacity(stripWidth, items.length, PLUS_BTN_WIDTH, moreWidth) : items.length;
	const shown = visibleTabs(items, capacity);
	const hidden = items.filter((t) => !shown.includes(t));
	const hasOverflow = hidden.length > 0;

	// The '+N' label widens with N's digit count, so track its real width.
	useLayoutEffect(() => {
		const el = moreBtnRef.current;
		if (!hasOverflow || !el) return;
		setMoreWidth(el.offsetWidth);
		const ro = new ResizeObserver(() => setMoreWidth(el.offsetWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, [hasOverflow]);


	const closeButton = (tab: HeaderTab, size: number) => (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				tab.close();
			}}
			title={t("rightPanel.closeTab")}
			aria-label={t("rightPanel.closeTab")}
			className="shrink-0 rounded p-0.5 text-neutral-400 opacity-70 transition-all hover:bg-neutral-700 hover:text-neutral-100 hover:opacity-100"
		>
			<X size={size} />
		</button>
	);

	const detachButton = (tab: HeaderTab, size: number) =>
		tab.detach && (
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOverflowOpen(false);
					tab.detach?.();
				}}
				title={t("rightPanel.collapseToService")}
				aria-label={t("rightPanel.collapseToService")}
				className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
			>
				<Minus size={size} />
			</button>
		);

	return (
		<div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border-divider)] bg-neutral-950/80 px-1.5 select-none">
			<div ref={stripRef} className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
				{/* flex-basis is set explicitly: a flex container's intrinsic width
				    ignores its items' flex-basis, so without it every tab would
				    collapse to its content width and clip its own label. */}
				<div
					role="tablist"
					className="-ml-1.5 flex h-10 min-w-0 shrink items-stretch self-start overflow-hidden pl-1.5 pr-1.5 -mr-1.5"
					style={{
						gap: TAB_GAP,
						flexBasis: shown.length * MAX_TAB_WIDTH + Math.max(0, shown.length - 1) * TAB_GAP,
					}}
				>
					{shown.map((tab, i) => {
						const prev = shown[i - 1];
						// Chrome hides the divider next to an active or hovered tab.
						const dimSeparator =
							!!prev &&
							(prev.active || tab.active || prev.key === hoveredTab || tab.key === hoveredTab);
						return (
							<div
								key={tab.key}
								role="tab"
								aria-selected={tab.active}
								title={tab.title}
								onClick={tab.activate}
								onContextMenu={(e) => {
									if (!tab.menu) return;
									e.preventDefault();
									setTabMenu({ x: e.clientX, y: e.clientY, items: tab.menu });
								}}
								onMouseEnter={() => setHoveredTab(tab.key)}
								onMouseLeave={() => setHoveredTab((k) => (k === tab.key ? null : k))}
								onMouseDown={(e) => {
									if (e.button === 1) e.preventDefault();
								}}
								onAuxClick={(e) => {
									if (e.button === 1) tab.close();
								}}
								style={{ flexBasis: MAX_TAB_WIDTH, minWidth: MIN_TAB_WIDTH }}
								className={clsx(
									"group relative flex h-full shrink cursor-pointer items-center rounded-t-lg px-2 text-xs transition-colors",
									tab.active
										? "bg-[var(--bg-panel)] text-neutral-100 before:pointer-events-none before:absolute before:bottom-0 before:-left-1.5 before:h-1.5 before:w-1.5 before:bg-[radial-gradient(circle_at_0_0,transparent_6px,var(--bg-panel)_6.5px)] after:pointer-events-none after:absolute after:bottom-0 after:-right-1.5 after:h-1.5 after:w-1.5 after:bg-[radial-gradient(circle_at_100%_0,transparent_6px,var(--bg-panel)_6.5px)]"
										: "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200",
								)}
							>
								{prev && (
									<span
										aria-hidden
										className={clsx(
											"pointer-events-none absolute top-1/2 left-[-1.5px] h-4 w-px -translate-y-1/2 bg-neutral-600",
											dimSeparator && "opacity-0",
										)}
									/>
								)}
								{/* Label fades out at the right edge (no ellipsis); the fade widens on
								    active/hover to leave room for the absolutely-placed close button. */}
								<span
									className={clsx(
										"flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-var(--tab-fade-offset)-0.5rem),transparent_calc(100%-var(--tab-fade-offset)))]",
										tab.detach
											? tab.active
												? "[--tab-fade-offset:1.75rem]"
												: "[--tab-fade-offset:0px] group-hover:[--tab-fade-offset:1.75rem]"
											: tab.active
												? "[--tab-fade-offset:0.75rem]"
												: "[--tab-fade-offset:0px] group-hover:[--tab-fade-offset:0.75rem]",
									)}
								>
									{tab.lead}
									<span className="shrink-0 whitespace-nowrap">{tab.label}</span>
									{tab.badge > 0 && (
										<span className="shrink-0 rounded-full bg-neutral-700/80 px-1 text-[9px] font-medium leading-none text-neutral-300">
											{tab.badge}
										</span>
									)}
								</span>
								<div
									className={clsx(
										"absolute inset-y-0 right-1 items-center",
										tab.active ? "flex" : "hidden group-hover:flex",
									)}
								>
									<span className="hidden group-hover:flex">{detachButton(tab, 11)}</span>
									{closeButton(tab, 11)}
								</div>
							</div>
						);
					})}
				</div>

				{hasOverflow && (
					<button
						ref={moreBtnRef}
						type="button"
						onClick={() => setOverflowOpen((v) => !v)}
						title={t("rightPanel.allTabsWithHidden", { count: hidden.length })}
						aria-label={t("rightPanel.allTabs")}
						className={clsx(
							"flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] transition-colors",
							overflowOpen
								? "bg-neutral-800 text-neutral-100"
								: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
						)}
					>
						+{hidden.length}
						<ChevronDown size={11} />
					</button>
				)}

				<button
					ref={plusBtnRef}
					type="button"
					onClick={() => setMenuOpen((v) => !v)}
					className={clsx(
						"flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
						menuOpen
							? "bg-neutral-800 text-neutral-100"
							: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
					)}
					title={t("rightPanel.openNewTab")}
					aria-label={t("rightPanel.openNewTab")}
				>
					<Plus size={14} />
				</button>
			</div>

			<button
				type="button"
				onClick={toggleRight}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800/80 hover:text-neutral-200"
				title={t("rightPanel.collapsePanel")}
				aria-label={t("rightPanel.collapsePanel")}
			>
				<PanelRightClose size={15} />
			</button>

			{/* Tab right-click menu (side-chat tabs) */}
			<FloatingLayer
				anchor={tabMenu ? { x: tabMenu.x, y: tabMenu.y } : null}
				layer="menu"
				placement="bottom-start"
				offset={2}
				onDismiss={() => setTabMenu(null)}
				className="min-w-36 py-1 text-xs"
			>
				{tabMenu?.items.map((item) => (
					<button
						key={item.key}
						type="button"
						onClick={() => {
							setTabMenu(null);
							void item.run();
						}}
						className="flex w-full items-center px-3 py-1.5 text-left text-neutral-300 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
					>
						{item.label}
					</button>
				))}
			</FloatingLayer>

			{/* Overflow menu: every tab, so the full list is reachable */}
			<FloatingLayer
				anchor={overflowOpen && hidden.length > 0 ? moreBtnRef.current : null}
				placement="bottom-end"
				offset={4}
				layer="popover"
				ignoreRefs={[moreBtnRef]}
				onDismiss={() => setOverflowOpen(false)}
				className="w-56 overflow-y-auto p-1 text-xs text-neutral-200"
			>
				{items.map((tab) => (
					<div
						key={tab.key}
						title={tab.title}
						onClick={() => {
							tab.activate();
							setOverflowOpen(false);
						}}
						className={clsx(
							"group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
							tab.active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60",
						)}
					>
						{tab.lead}
						<span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">{tab.label}</span>
						{tab.badge > 0 && (
							<span className="shrink-0 text-[10px] text-neutral-500">{tab.badge}</span>
						)}
						<div className="hidden shrink-0 items-center group-hover:flex">
							{detachButton(tab, 12)}
							{closeButton(tab, 12)}
						</div>
					</div>
				))}
			</FloatingLayer>

			{/* Feature menu */}
			<FloatingLayer
				anchor={menuOpen ? plusBtnRef.current : null}
				placement="bottom-end"
				offset={4}
				layer="popover"
				ignoreRefs={[plusBtnRef]}
				onDismiss={() => setMenuOpen(false)}
				className="w-48 p-1.5 text-xs text-neutral-200"
			>
				<div className="space-y-0.5">
					<button
						type="button"
						onClick={() => {
							// Add the tab BEFORE activating the panel: CommandTerminalPanel's mount
							// effect spawns a shell when no visible tab exists, so activating first
							// let it race this click and create two terminals.
							addTerminalTab();
							setRightTab("terminal");
							setMenuOpen(false);
						}}
						className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-neutral-300 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
					>
						<SquareTerminal size={14} className="text-emerald-400" />
						<span>{t("rightPanel.newTerminal")}</span>
					</button>
					<div className="my-1 border-t border-[var(--border-divider)]" />
					{PRIMARY_TABS.filter((tab) => tab.id !== "files").map((tab) => {
						const Icon = tab.icon;
						const badge = tabBadges[tab.id] ?? 0;
						const isOpen = openRightTabs.includes(tab.id) && tab.id !== "sidechat";
						const sideChatBlocked = tab.id === "sidechat" && !selectedId;
						return (
							<button
								key={tab.id}
								type="button"
								disabled={sideChatBlocked}
								title={sideChatBlocked ? t("rightPanel.sideChatNeedSession") : undefined}
								onClick={() => {
									if (tab.id === "sidechat") {
										if (!selectedId) return;
										openNewSideChat(selectedId);
									} else setRightTab(tab.id);
									setMenuOpen(false);
								}}
								className={clsx(
									"flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors",
									sideChatBlocked
										? "cursor-not-allowed text-neutral-600"
										: activeTab === tab.id
											? "bg-neutral-800 text-neutral-100"
											: "text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100",
								)}
							>
								<div className="flex items-center gap-2.5">
									<Icon size={14} className={tab.iconColor} />
									<span>{tab.id === "sidechat" ? t("rightPanel.newSideChat") : tabLabel(tab.id)}</span>
								</div>
								<div className="flex items-center gap-1.5">
									{badge > 0 && (
										<span className="rounded-full bg-neutral-700/80 px-1.5 text-[10px] font-medium leading-tight text-neutral-300">
											{badge}
										</span>
									)}
									{isOpen && (
										<Check size={12} className="text-neutral-400" aria-label={t("rightPanel.opened")} />
									)}
								</div>
							</button>
						);
					})}
				</div>
			</FloatingLayer>
		</div>
	);
}
