import { Bell, Clock, Gauge, Search, Settings, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../../core/api";
import { events } from "../../core/sse";
import { nav, paths } from "../../core/nav";
import { AppMark, IconButton, Segmented } from "../../ui";
import { useOverlay, usePresence } from "../../ui/overlay";
import { useSessionActions } from "./ActionSheets";
import { ChronologicalView } from "./ChronologicalView";
import { inboxCount, type InboxData } from "./inbox";
import { ModeSwitch } from "./ModeSwitch";
import { startTodosSync, useTodos } from "./todos";
import { TreeView } from "./TreeView";
import { startTreeSync, useTree } from "./treeStore";
import type { TreeSession } from "./tree";

export type LeftNavViewMode = "project" | "time";

const VIEW_OPTIONS = [
	{ value: "project", label: "按项目" },
	{ value: "time", label: "按时间" },
] as const;

const ANIM_MS = 300;
/** Horizontal swipe distance (px) or flick velocity (px/ms) that closes the drawer. */
const SWIPE_CLOSE_PX = 90;
const SWIPE_CLOSE_V = 0.5;

const I = { size: 22, strokeWidth: 1.75 } as const;

function BottomCell({ icon, label, onClick, badge, ariaLabel }: { icon: ReactNode; label: string; onClick: () => void; badge?: number; ariaLabel?: string }) {
	return (
		<button
			type="button"
			aria-label={ariaLabel ?? label}
			onClick={onClick}
			className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-m-md py-1.5 text-m-text-2 transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover"
		>
			<span className="relative flex">
				{icon}
				{badge != null && badge > 0 && (
					<span
						aria-hidden
						className="absolute -top-1.5 left-3.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-m-pill bg-m-danger px-1 text-[11px] leading-none font-medium whitespace-nowrap text-m-bg"
					>
						{badge > 99 ? "99+" : badge}
					</span>
				)}
			</span>
			<span className="text-m-xs whitespace-nowrap">{label}</span>
		</button>
	);
}

/**
 * Full-screen navigation drawer (docs/MOBILE_DESIGN.md §4.3): slides in from the left; ✕, back or a
 * leftward swipe closes it. While open it keeps the session tree and the inbox badge fresh.
 */
export function MenuSheet({
	open,
	onClose,
	onNewSession,
}: {
	open: boolean;
	onClose: () => void;
	onNewSession?: () => void;
}) {
	const { mounted, visible } = usePresence(open, ANIM_MS);
	useOverlay(open, onClose);
	const [viewMode, setViewMode] = useState<LeftNavViewMode>("project");
	const [inbox, setInbox] = useState<InboxData | null>(null);
	const todos = useTodos((s) => s.todos);
	const openSession = useCallback((s: TreeSession) => {
		onClose();
		nav.push(paths.chat(s.id));
	}, [onClose]);
	const { openActions, node } = useSessionActions(openSession);
	const panelRef = useRef<HTMLDivElement>(null);
	const swipe = useRef<{ x: number; y: number; t: number; dx: number; axis: "x" | "y" | null } | null>(null);

	useEffect(() => {
		if (!open) return;
		if (!useTree.getState().data) void useTree.getState().load();
		const offTree = startTreeSync();
		const offTodos = startTodosSync();
		let alive = true;
		const loadInbox = () => api<InboxData>("GET", "/left/inbox")
			.then((d) => { if (alive) setInbox(d); })
			.catch(() => {});
		void loadInbox();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const soon = () => { clearTimeout(timer); timer = setTimeout(() => void loadInbox(), 400); };
		const offs = [events.on("session", soon), events.on("hello", soon), events.on("resync", soon)];
		return () => {
			alive = false;
			clearTimeout(timer);
			offs.forEach((off) => off());
			offTree();
			offTodos();
		};
	}, [open]);

	if (!mounted) return null;

	const go = (path: string) => {
		onClose();
		nav.push(path);
	};
	const badge = inboxCount(inbox, todos);

	const onTouchStart = (e: ReactTouchEvent) => {
		const p = e.touches[0];
		if (!p || e.touches.length !== 1) {
			swipe.current = null;
			return;
		}
		swipe.current = { x: p.clientX, y: p.clientY, t: e.timeStamp, dx: 0, axis: null };
	};
	const onTouchMove = (e: ReactTouchEvent) => {
		const s = swipe.current;
		const p = e.touches[0];
		const el = panelRef.current;
		if (e.touches.length !== 1) {
			swipe.current = null;
			if (el) { el.style.transition = ""; el.style.transform = ""; }
			return;
		}
		if (!s || !p || !el) return;
		const dx = p.clientX - s.x;
		const dy = p.clientY - s.y;
		if (s.axis === null) {
			if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
			s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 && dx < 0 ? "x" : "y";
			if (s.axis === "x") el.style.transition = "none";
		}
		if (s.axis !== "x") return;
		s.dx = Math.min(0, dx);
		el.style.transform = `translate3d(${s.dx}px,0,0)`;
	};
	const onTouchEnd = (e: ReactTouchEvent) => {
		const s = swipe.current;
		swipe.current = null;
		const el = panelRef.current;
		if (!s || s.axis !== "x" || !el) return;
		// Hand the offset back to the class transform; the transition finishes the slide either way.
		el.style.transition = "";
		el.style.transform = "";
		const v = -s.dx / Math.max(1, e.timeStamp - s.t);
		if (-s.dx > SWIPE_CLOSE_PX || v > SWIPE_CLOSE_V) onClose();
	};
	const onTouchCancel = () => {
		swipe.current = null;
		const el = panelRef.current;
		if (el) { el.style.transition = ""; el.style.transform = ""; }
	};

	return createPortal(
		<div className="fixed inset-0 z-(--z-sheet)">
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label="导航"
				onTouchStart={onTouchStart}
				onTouchMove={onTouchMove}
				onTouchEnd={onTouchEnd}
				onTouchCancel={onTouchCancel}
				className={`absolute inset-0 flex w-full flex-col bg-m-bg text-m-text outline-none transition-transform duration-300 ease-m-sheet ${
					visible ? "translate-x-0" : "-translate-x-full"
				}`}
				style={{ paddingTop: "var(--m-safe-top)", paddingBottom: "var(--m-safe-bottom)" }}
			>
				<header className="flex h-16 shrink-0 items-center gap-2.5 pr-3 pl-5">
					<AppMark size={26} />
					<span className="min-w-0 flex-1 text-m-lg font-medium whitespace-nowrap">OMP</span>
					<IconButton variant="filled" icon={<Search {...I} />} label="搜索会话" onClick={() => go(paths.search())} />
					<IconButton variant="filled" icon={<X {...I} />} label="关闭导航" onClick={onClose} />
				</header>

				<div className="shrink-0">
					<div className="flex flex-col gap-1 px-3 pt-2">
						<button
							type="button"
							onClick={() => {
								onClose();
								onNewSession?.();
							}}
							className="flex h-12 w-full items-center gap-3.5 rounded-m-pill bg-m-surface px-4 text-left text-m-md text-m-text transition-colors duration-(--m-dur-fast) active:bg-m-surface-2"
						>
							<SquarePen {...I} className="text-m-text-2" />
							<span className="whitespace-nowrap">发起新对话</span>
						</button>
						<button
							type="button"
							onClick={() => go(paths.schedules())}
							className="flex h-12 w-full items-center gap-3.5 rounded-m-pill px-4 text-left text-m-md text-m-text transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover"
						>
							<Clock {...I} className="text-m-text-2" />
							<span className="whitespace-nowrap">定时任务</span>
						</button>
					</div>

					<div className="flex items-center gap-2 px-4 pt-4 pb-2">
						<ModeSwitch />
						<Segmented label="视图" className="min-w-0 flex-1" value={viewMode} options={VIEW_OPTIONS} onChange={setViewMode} />
					</div>
				</div>
				<div className="m-noscrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">

					{viewMode === "project" ? (
						<TreeView onMore={openActions} onOpen={openSession} />
					) : (
						<ChronologicalView onMore={openActions} onOpen={openSession} />
					)}
				</div>

				<nav aria-label="更多入口" className="grid shrink-0 grid-cols-3 gap-1 border-t border-m-border px-3 pt-1.5 pb-1">
					<BottomCell
						icon={<Bell {...I} />}
						label="收件箱"
						ariaLabel={badge > 0 ? `收件箱，${badge} 项待处理` : "收件箱"}
						badge={badge}
						onClick={() => go(paths.inbox())}
					/>
					<BottomCell icon={<Gauge {...I} />} label="订阅与配额" onClick={() => go(paths.quota())} />
					<BottomCell icon={<Settings {...I} />} label="设置" onClick={() => go(paths.settings())} />
				</nav>
			</div>
			{node}
		</div>,
		document.body,
	);
}
