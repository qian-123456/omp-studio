import clsx from "clsx";
import {
	Coins,
	CheckSquare,
	ChevronDown,
	Cpu,
	Folder,
	GitBranch,
	MessageSquare,
	PanelRightClose,
	Plus,
	X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { type RightTab, useUi } from "../stores/ui";
import { isComposing } from "../lib/hooks";

interface RightPanelHeaderProps {
	activeTab: RightTab;
	tabBadges: Record<RightTab, number>;
}

export function RightPanelHeader({
	activeTab,
	tabBadges,
}: RightPanelHeaderProps) {
	const setRightTab = useUi((s) => s.setRightTab);
	const toggleRight = useUi((s) => s.toggleRight);

	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const plusBtnRef = useRef<HTMLButtonElement>(null);

	// Close menu on click outside
	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (
				menuRef.current &&
				!menuRef.current.contains(e.target as Node) &&
				plusBtnRef.current &&
				!plusBtnRef.current.contains(e.target as Node)
			) {
				setMenuOpen(false);
			}
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	// Close menu on Escape
	useEffect(() => {
		if (!menuOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				setMenuOpen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [menuOpen]);

	const PRIMARY_TABS: {
		id: RightTab;
		label: string;
		icon: React.ComponentType<{ size?: number; className?: string }>;
		iconColor: string;
	}[] = [
		{
			id: "sidechat",
			label: "辅助对话",
			icon: MessageSquare,
			iconColor: "text-sky-400",
		},
		{
			id: "explorer",
			label: "资源管理器",
			icon: Folder,
			iconColor: "text-amber-400",
		},
		{
			id: "git",
			label: "Git",
			icon: GitBranch,
			iconColor: "text-orange-400",
		},
		{
			id: "todos",
			label: "待办",
			icon: CheckSquare,
			iconColor: "text-indigo-400",
		},
		{
			id: "services",
			label: "服务",
			icon: Cpu,
			iconColor: "text-purple-400",
		},
	];

	const HEATMAP_TAB = {
		id: "heatmap" as RightTab,
		label: "Token 用量",
		icon: Coins,
		iconColor: "text-amber-400",
	};

	const ALL_TABS = [...PRIMARY_TABS, HEATMAP_TAB];

	const currentTabInfo =
		ALL_TABS.find((t) => t.id === activeTab) || ALL_TABS[0];
	const ActiveIcon = currentTabInfo.icon;
	const activeBadge = tabBadges[activeTab] ?? 0;

	return (
		<div className="relative flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-2 select-none">
			{/* Left controls: chevron + active tab pill + plus button matching Image 2 */}
			<div className="flex items-center gap-1.5 min-w-0">
				{/* Down Chevron button */}
				<button
					type="button"
					onClick={() => setMenuOpen((v) => !v)}
					className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 transition-colors"
					title="切换标签页"
					aria-label="切换标签页"
				>
					<ChevronDown
						size={14}
						className={clsx(
							"transition-transform duration-200",
							menuOpen && "rotate-180 text-neutral-200",
						)}
					/>
				</button>

				{/* Active Tab Pill matching Image 2 */}
				<div className="flex items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-800/90 px-2.5 py-1 text-xs text-neutral-100 shadow-sm">
					<ActiveIcon
						size={13}
						className={clsx(currentTabInfo.iconColor, "shrink-0")}
					/>
					<span className="font-medium truncate max-w-[120px]">
						{currentTabInfo.label}
					</span>
					{activeBadge > 0 && (
						<span className="rounded-full bg-neutral-700 px-1.5 py-0.2 text-[10px] font-medium leading-tight text-neutral-200">
							{activeBadge}
						</span>
					)}
					{/* Close tab button */}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setRightTab(null);
						}}
						className="ml-0.5 rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
						title="关闭此标签页"
						aria-label="关闭此标签页"
					>
						<X size={12} />
					</button>
				</div>

				{/* Plus button matching Image 2 */}
				<button
					ref={plusBtnRef}
					type="button"
					onClick={() => setMenuOpen((v) => !v)}
					className={clsx(
						"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
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

			{/* Right actions: compact heatmap toggle + toggle panel button */}
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => {
						if (activeTab === "heatmap") {
							setRightTab(null);
						} else {
							setRightTab("heatmap");
						}
					}}
					className={clsx(
						"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
						activeTab === "heatmap"
							? "bg-amber-950/80 text-amber-300 border border-amber-800/60"
							: "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
					)}
					aria-label="Token 用量"
					title={activeTab === "heatmap" ? "收起 Token 用量" : "查看 Token 用量"}
				>
					<Coins
						size={14}
						className={activeTab === "heatmap" ? "text-amber-400" : "text-neutral-400"}
					/>
				</button>

				<button
					type="button"
					onClick={toggleRight}
					className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 transition-colors"
					title="收起侧边面板 (⌘J)"
					aria-label="收起侧边面板 (⌘J)"
				>
					<PanelRightClose size={15} />
				</button>
			</div>

			{/* Vertical Dropdown Popover matching Image 3 */}
			{menuOpen && (
				<div
					ref={menuRef}
					className="absolute left-10 top-full z-50 mt-1 w-48 rounded-xl border border-neutral-800 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-md text-xs text-neutral-200 animate-in fade-in zoom-in-95 duration-100"
				>
					<div className="space-y-0.5">
						{PRIMARY_TABS.map((tab) => {
							const Icon = tab.icon;
							const badge = tabBadges[tab.id] ?? 0;
							const isCurrent = activeTab === tab.id;
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
										isCurrent
											? "bg-neutral-800 text-neutral-100 font-medium"
											: "text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100",
									)}
								>
									<div className="flex items-center gap-2.5">
										<Icon size={14} className={tab.iconColor} />
										<span>{tab.label}</span>
									</div>
									{badge > 0 && (
										<span className="rounded-full bg-neutral-700/80 px-1.5 py-0.2 text-[10px] font-medium leading-tight text-neutral-300">
											{badge}
										</span>
									)}
								</button>
							);
						})}

						{/* Demoted secondary section: Heatmap */}
						<div className="border-t border-neutral-800/80 pt-1 mt-1">
							<button
								type="button"
								onClick={() => {
									setRightTab("heatmap");
									setMenuOpen(false);
								}}
								className={clsx(
									"flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition-colors",
									activeTab === "heatmap"
										? "bg-neutral-800 text-neutral-100 font-medium"
										: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
								)}
							>
								<div className="flex items-center gap-2.5">
									<Coins size={14} className="text-amber-400" />
									<span>Token 用量 (统计分析)</span>
								</div>
								{tabBadges.heatmap > 0 && (
									<span className="rounded-full bg-neutral-700/80 px-1.5 py-0.2 text-[10px] font-medium leading-tight text-neutral-300">
										{tabBadges.heatmap}
									</span>
								)}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
