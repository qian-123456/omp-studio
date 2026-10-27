import { Bell, CalendarClock, PieChart, Plus, Search, Settings, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { nav, paths } from "../../core/nav";
import { useOverlay, usePresence } from "../../ui/overlay";
import { useSessionActions } from "./ActionSheets";
import { ChronologicalView } from "./ChronologicalView";
import { ModeSwitch } from "./ModeSwitch";
import { openTodos, useTodos } from "./todos";
import { TreeView } from "./TreeView";

export type LeftNavViewMode = "project" | "time";

export function MenuSheet({
	open,
	onClose,
	onNewSession,
}: {
	open: boolean;
	onClose: () => void;
	onNewSession?: () => void;
}) {
	const { mounted, visible } = usePresence(open);
	useOverlay(open, onClose);
	const [viewMode, setViewMode] = useState<LeftNavViewMode>("project");
	const todoCount = useTodos((s) => openTodos(s.todos).length);
	const { openActions, node } = useSessionActions();

	if (!mounted) return null;

	return createPortal(
		<div className="fixed inset-0 z-(--z-sheet)">
			{/* Backdrop scrim */}
			<div
				aria-hidden
				onClick={onClose}
				className={`absolute inset-0 bg-m-scrim transition-opacity duration-240 ease-(--m-ease) ${
					visible ? "opacity-100" : "opacity-0"
				}`}
			/>

			{/* Full screen / slide-in navigation drawer */}
			<div
				role="dialog"
				aria-modal="true"
				className={`absolute inset-y-0 left-0 flex w-full max-w-[340px] flex-col bg-m-bg-elev text-m-text shadow-m-pop outline-none transition-transform duration-240 ease-(--m-ease) ${
					visible ? "translate-x-0" : "-translate-x-full"
				}`}
				style={{
					paddingTop: "max(12px, var(--m-safe-top))",
					paddingBottom: "max(12px, var(--m-safe-bottom))",
				}}
			>
				{/* Top bar with branding and close button */}
				<div className="flex shrink-0 items-center justify-between px-4 pb-2">
					<div className="flex items-center gap-2">
						<Sparkles size={20} className="text-m-accent" />
						<span className="text-m-md font-semibold text-m-text">omp-workspace</span>
					</div>
					<button
						type="button"
						aria-label="关闭导航"
						onClick={onClose}
						className="flex size-10 items-center justify-center rounded-full text-m-text-3 active:bg-m-surface-hover"
					>
						<X size={20} />
					</button>
				</div>

				{/* Top actions: 发起新对话, 搜索会话, 定时任务 */}
				<div className="shrink-0 space-y-1.5 px-3 pb-3 pt-1">
					<button
						type="button"
						onClick={() => {
							onClose();
							onNewSession?.();
						}}
						className="flex min-h-11 w-full items-center justify-center gap-2 rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text shadow-sm active:opacity-80"
					>
						<Plus size={18} />
						<span>发起新对话</span>
					</button>

					<div className="grid grid-cols-2 gap-1.5 pt-1">
						<button
							type="button"
							onClick={() => {
								onClose();
								nav.push(paths.search());
							}}
							className="flex min-h-10 items-center justify-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
						>
							<Search size={16} className="text-m-text-2 shrink-0" />
							<span>搜索会话</span>
						</button>
						<button
							type="button"
							onClick={() => {
								onClose();
								nav.push(paths.schedules());
							}}
							className="flex min-h-10 items-center justify-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
						>
							<CalendarClock size={16} className="text-m-text-2 shrink-0" />
							<span>定时任务</span>
						</button>
					</div>
				</div>

				{/* Middle section: Space selector & "按项目 / 按时间" view toggle */}
				<div className="shrink-0 border-t border-m-border px-3 py-2">
					<div className="flex items-center justify-between gap-2 pb-2">
						<ModeSwitch />
					</div>
					<div
						role="tablist"
						aria-label="视图切换"
						className="flex rounded-m-pill border border-m-border bg-m-surface p-0.5"
					>
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "project"}
							onClick={() => setViewMode("project")}
							className={`flex-1 rounded-m-pill py-1.5 text-center text-m-xs font-medium transition-colors ${
								viewMode === "project"
									? "bg-m-accent text-m-accent-text shadow-xs"
									: "text-m-text-2 active:bg-m-surface-hover"
							}`}
						>
							按项目
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "time"}
							onClick={() => setViewMode("time")}
							className={`flex-1 rounded-m-pill py-1.5 text-center text-m-xs font-medium transition-colors ${
								viewMode === "time"
									? "bg-m-accent text-m-accent-text shadow-xs"
									: "text-m-text-2 active:bg-m-surface-hover"
							}`}
						>
							按时间
						</button>
					</div>
				</div>

				{/* Middle scrollable session list (Tree or Chronological) */}
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{viewMode === "project" ? (
						<TreeView
							onMore={openActions}
							onOpen={(s) => {
								onClose();
								nav.push(paths.chat(s.id));
							}}
						/>
					) : (
						<ChronologicalView
							onMore={openActions}
							onOpen={(s) => {
								onClose();
								nav.push(paths.chat(s.id));
							}}
						/>
					)}
				</div>

				{/* Bottom section: 收件箱, 订阅与配额, 设置 */}
				<div className="shrink-0 border-t border-m-border bg-m-bg-elev px-2 pt-2">
					<button
						type="button"
						onClick={() => {
							onClose();
							nav.push(paths.inbox());
						}}
						className="flex min-h-12 w-full items-center gap-3 rounded-m-md px-3 text-left text-m-sm text-m-text active:bg-m-surface-hover"
					>
						<Bell size={20} className="text-m-text-2 shrink-0" />
						<span className="flex-1 font-medium">收件箱</span>
						{todoCount > 0 && (
							<span className="rounded-m-pill bg-m-accent px-2 py-0.5 text-m-xs font-medium text-m-accent-text">
								{todoCount}
							</span>
						)}
					</button>

					<button
						type="button"
						onClick={() => {
							onClose();
							nav.push(paths.quota());
						}}
						className="flex min-h-12 w-full items-center gap-3 rounded-m-md px-3 text-left text-m-sm text-m-text active:bg-m-surface-hover"
					>
						<PieChart size={20} className="text-m-text-2 shrink-0" />
						<span className="flex-1 font-medium">订阅与配额</span>
					</button>

					<button
						type="button"
						onClick={() => {
							onClose();
							nav.push(paths.settings());
						}}
						className="flex min-h-12 w-full items-center gap-3 rounded-m-md px-3 text-left text-m-sm text-m-text active:bg-m-surface-hover"
					>
						<Settings size={20} className="text-m-text-2 shrink-0" />
						<span className="flex-1 font-medium">设置</span>
					</button>
				</div>
			</div>
			{node}
		</div>,
		document.body,
	);
}
