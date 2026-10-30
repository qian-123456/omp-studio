import clsx from "clsx";
import {
	Coins,
	Cpu,
	Folder,
	GitBranch,
	MessageSquare,
	NotebookPen,
	PanelRightClose,
	SquareTerminal,
} from "lucide-react";
import React from "react";
import { deriveLoadState } from "../lib/loadState";
import { useSessions } from "../stores/sessions";
import { type RightTab, useUi } from "../stores/ui";
import { openNewSideChat } from "../features/sidechat/viewStore";
import { useT } from "../stores/language";

interface RightPanelEmptyStateProps {
	tabBadges: Record<RightTab, number>;
}

export function RightPanelEmptyState({ tabBadges }: RightPanelEmptyStateProps) {
	const { t } = useT();
	const setRightTab = useUi((s) => s.setRightTab);
	const selectedId = useUi((s) => s.selectedSessionId);
	const toggleRight = useUi((s) => s.toggleRight);
	// Tab badges are derived from the session index; show a placeholder until it arrives.
	const badgesLoading =
		deriveLoadState(
			useSessions((s) => s.hasLoaded),
			useSessions((s) => s.loadError),
		) === "loading";

	const PRIMARY_OPTIONS: {
		id: RightTab;
		icon: React.ComponentType<{ size?: number; className?: string }>;
		iconColor: string;
	}[] = [
		{ id: "explorer", icon: Folder, iconColor: "text-amber-400" },
		{ id: "git", icon: GitBranch, iconColor: "text-orange-400" },
		{ id: "sidechat", icon: MessageSquare, iconColor: "text-sky-400" },
		{ id: "services", icon: Cpu, iconColor: "text-purple-400" },
		{ id: "heatmap", icon: Coins, iconColor: "text-amber-400" },
		{ id: "terminal", icon: SquareTerminal, iconColor: "text-emerald-400" },
		{ id: "plan", icon: NotebookPen, iconColor: "text-amber-400" },
	];

	return (
		<div className="relative flex h-full flex-col bg-neutral-900/40 text-neutral-200 select-none">
			{/* Top right close button matching Image 1 */}
		<div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--border-divider)] px-3">
				<button
					type="button"
					onClick={toggleRight}
					className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					title={t("rightPanel.collapsePanel")}
					aria-label={t("rightPanel.collapsePanel")}
				>
					<PanelRightClose size={15} />
				</button>
			</div>

			{/* Centered card list matching Image 1 */}
			<div className="flex flex-1 flex-col items-center justify-center px-6 pb-12">
				<div className="w-full max-w-xs space-y-6">
					{/* Header titles */}
					<div className="text-center space-y-1.5">
						<h2 className="text-lg font-bold text-neutral-100 tracking-tight">
							{t("rightPanel.openTabsTitle")}
						</h2>
						<p className="text-xs text-neutral-400">
							{t("rightPanel.openTabsDesc")}
						</p>
					</div>

					{/* Vertical button cards */}
					<div className="space-y-2">
						{PRIMARY_OPTIONS.map((opt) => {
							const Icon = opt.icon;
							const badge = tabBadges[opt.id] ?? 0;
							const blocked = opt.id === "sidechat" && !selectedId;
							return (
								<button
									key={opt.id}
									type="button"
									disabled={blocked}
									title={blocked ? t("rightPanel.sideChatNeedSession") : undefined}
									onClick={() => {
										// A side-chat group only exists while it has chats: open a blank one.
										if (opt.id === "sidechat") {
											if (selectedId) openNewSideChat(selectedId);
										} else setRightTab(opt.id);
									}}
									className={clsx(
										"group flex w-full items-center justify-between rounded-xl border border-neutral-800/80 bg-neutral-800/40 p-3 text-left transition-all",
										blocked
											? "cursor-not-allowed opacity-40"
											: "hover:border-neutral-700/80 hover:bg-neutral-800 hover:shadow-lg hover:shadow-neutral-950/20 active:scale-[0.99]",
									)}
								>
									<div className="flex items-center gap-3">
										<Icon
											size={16}
											className={clsx(
												opt.iconColor,
												"transition-transform group-hover:scale-110",
											)}
										/>
										<span className="text-xs font-medium text-neutral-200 group-hover:text-neutral-100">
											{t(`rightPanel.${opt.id}`)}
										</span>
									</div>

									{badgesLoading && (
										<span
											role="status"
											title={t("rightPanel.loading")}
											className="h-4 w-6 animate-pulse rounded-full bg-neutral-700/60"
										/>
									)}
									{!badgesLoading && badge > 0 && (
										<span className="rounded-full bg-neutral-700/80 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
											{badge}
										</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
