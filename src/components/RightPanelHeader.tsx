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
	CheckSquare,
	ChevronDown,
	Coins,
	Cpu,
	Folder,
	GitBranch,
	MessageSquare,
	Minus,
	PanelRightClose,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
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

interface RightPanelHeaderProps {
	activeTab: RightTab;
	tabBadges: Record<RightTab, number>;
}

type IconType = React.ComponentType<{ size?: number; className?: string }>;

const PRIMARY_TABS: { id: RightTab; label: string; icon: IconType; iconColor: string }[] = [
	{ id: "sidechat", label: "辅助对话", icon: MessageSquare, iconColor: "text-sky-400" },
	{ id: "explorer", label: "资源管理器", icon: Folder, iconColor: "text-amber-400" },
	{ id: "git", label: "Git", icon: GitBranch, iconColor: "text-orange-400" },
	{ id: "todos", label: "待办", icon: CheckSquare, iconColor: "text-indigo-400" },
	{ id: "services", label: "服务", icon: Cpu, iconColor: "text-purple-400" },
	{ id: "heatmap", label: "Token 用量", icon: Coins, iconColor: "text-amber-400" },
	{ id: "terminal", label: "终端", icon: SquareTerminal, iconColor: "text-emerald-400" },
];

/** Narrowest a tab may shrink to (≈ icon + close) before it moves into the overflow menu. */
const MIN_TAB_WIDTH = 64;
const TAB_GAP = 2;

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
}

export function RightPanelHeader({ activeTab, tabBadges }: RightPanelHeaderProps) {
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
	const rowRef = useRef<HTMLDivElement>(null);
	const [rowWidth, setRowWidth] = useState(0);

	useLayoutEffect(() => {
		const el = rowRef.current;
		if (!el) return;
		setRowWidth(el.clientWidth);
		const ro = new ResizeObserver(() => setRowWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const visibleTerminals = drawerTabs.filter((t) => !t.detached);
	const items: HeaderTab[] = openRightTabs.flatMap((id): HeaderTab[] => {
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
		return [
			{
				key: id,
				label: info.label,
				title: info.label,
				lead: <Icon size={13} className={clsx(info.iconColor, "shrink-0")} />,
				badge: tabBadges[id] ?? 0,
				active: id === activeTab,
				activate: () => setRightTab(id),
				close: () => closeRightTab(id),
			},
		];
	});

	// Keep store order, but swap the active tab into the last inline slot if it would overflow.
	const capacity =
		rowWidth > 0 ? Math.max(1, Math.floor((rowWidth + TAB_GAP) / (MIN_TAB_WIDTH + TAB_GAP))) : items.length;
	let shown = items;
	if (items.length > capacity) {
		shown = items.slice(0, capacity);
		const active = items.find((t) => t.active);
		if (active && !shown.includes(active)) shown = [...shown.slice(0, capacity - 1), active];
	}
	const hidden = items.filter((t) => !shown.includes(t));

	const closeButton = (tab: HeaderTab, size: number) => (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				tab.close();
			}}
			title="关闭标签页"
			aria-label="关闭标签页"
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
				title="折叠为后台服务"
				aria-label="折叠为后台服务"
				className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
			>
				<Minus size={size} />
			</button>
		);

	return (
		<div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-[var(--border-divider)] bg-neutral-950/80 px-1.5 select-none">
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<div
					ref={rowRef}
					role="tablist"
					className="flex min-w-0 flex-1 items-center overflow-hidden"
					style={{ gap: TAB_GAP }}
				>
					{shown.map((tab) => (
						<div
							key={tab.key}
							role="tab"
							aria-selected={tab.active}
							title={tab.title}
							onClick={tab.activate}
							onMouseDown={(e) => {
								if (e.button === 1) e.preventDefault();
							}}
							onAuxClick={(e) => {
								if (e.button === 1) tab.close();
							}}
							style={{ minWidth: MIN_TAB_WIDTH }}
							className={clsx(
								"group relative flex h-7 max-w-[160px] shrink min-w-[56px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
								tab.active
									? "border border-neutral-700/80 bg-neutral-800/90 font-medium text-neutral-100 shadow-xs"
									: "border border-transparent text-neutral-400 hover:border-neutral-800/60 hover:bg-neutral-800/50 hover:text-neutral-200",
							)}
						>
							{tab.lead}
							<span className="min-w-0 truncate">
								{tab.label}
							</span>
							{tab.badge > 0 && (
								<span className="shrink-0 rounded-full bg-neutral-700/80 px-1 text-[9px] font-medium leading-none text-neutral-300">
									{tab.badge}
								</span>
							)}
							<div
								className={clsx(
									"ml-auto shrink-0 items-center pl-0.5",
									tab.active ? "flex" : "hidden group-hover:flex",
								)}
							>
								<span className="hidden group-hover:flex">{detachButton(tab, 11)}</span>
								{closeButton(tab, 11)}
							</div>
						</div>
					))}
				</div>

				{hidden.length > 0 && (
					<button
						ref={moreBtnRef}
						type="button"
						onClick={() => setOverflowOpen((v) => !v)}
						title={`全部标签页（另有 ${hidden.length} 个未显示）`}
						aria-label="全部标签页"
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
					title="打开新标签页"
					aria-label="打开新标签页"
				>
					<Plus size={14} />
				</button>
			</div>

			<button
				type="button"
				onClick={toggleRight}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-800/80 hover:text-neutral-200"
				title="收起侧边面板 (⌘J)"
				aria-label="收起侧边面板 (⌘J)"
			>
				<PanelRightClose size={15} />
			</button>

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
						<span className="min-w-0 flex-1 truncate">{tab.label}</span>
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
							setRightTab("terminal");
							addTerminalTab();
							setMenuOpen(false);
						}}
						className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-neutral-300 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
					>
						<SquareTerminal size={14} className="text-emerald-400" />
						<span>新建终端</span>
					</button>
					<div className="my-1 border-t border-[var(--border-divider)]" />
					{PRIMARY_TABS.map((tab) => {
						const Icon = tab.icon;
						const badge = tabBadges[tab.id] ?? 0;
						const isOpen = openRightTabs.includes(tab.id);
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => {
									setRightTab(tab.id);
									setMenuOpen(false);
								}}
								className={clsx(
									"flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors",
									activeTab === tab.id
										? "bg-neutral-800 font-medium text-neutral-100"
										: "text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100",
								)}
							>
								<div className="flex items-center gap-2.5">
									<Icon size={14} className={tab.iconColor} />
									<span>{tab.label}</span>
								</div>
								<div className="flex items-center gap-1.5">
									{badge > 0 && (
										<span className="rounded-full bg-neutral-700/80 px-1.5 text-[10px] font-medium leading-tight text-neutral-300">
											{badge}
										</span>
									)}
									{isOpen && (
										<Check size={12} className="text-neutral-400" aria-label="已打开" />
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
