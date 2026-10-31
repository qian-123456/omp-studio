import { Bell, Clock, Gauge, Lightbulb, Search, Settings, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, TouchEvent as ReactTouchEvent } from "react";
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

/**
 * Navigation drawer (docs/MOBILE_DESIGN.md §4.3): slides in from the left; scrim, ✕, back or a
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
	const resetSwipe = useCallback(() => {
		swipe.current = null;
		const el = panelRef.current;
		if (!el) return;
		// Removing only the inline overrides restores the CSS spring-back transition.
		el.style.removeProperty("transition");
		el.style.removeProperty("transform");
	}, []);

	useEffect(() => {
		if (!open) {
			resetSwipe();
			return;
		}
		if (!mounted) return;
		const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	}, [open, mounted, resetSwipe]);

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
		resetSwipe();
		if (e.target instanceof Element && e.target.closest("[data-session-row]")) return;
		const p = e.touches[0];
		if (!p || e.touches.length !== 1) return;
		swipe.current = { x: p.clientX, y: p.clientY, t: e.timeStamp, dx: 0, axis: null };
	};
	const onTouchMove = (e: ReactTouchEvent) => {
		const s = swipe.current;
		const p = e.touches[0];
		const el = panelRef.current;
		if (e.touches.length !== 1) {
			resetSwipe();
			return;
		}
		if (!s || !p || !el) return;
		const dx = p.clientX - s.x;
		const dy = p.clientY - s.y;
		if (s.axis === null) {
			if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) return;
			s.axis = Math.abs(dx) > Math.abs(dy) * 1.6 && dx < -10 ? "x" : "y";
			if (s.axis === "x") el.style.transition = "none";
		}
		if (s.axis !== "x") return;
		s.dx = Math.min(0, dx);
		el.style.transform = `translate3d(${s.dx}px,0,0)`;
	};
	const onTouchEnd = (e: ReactTouchEvent) => {
		const s = swipe.current;
		resetSwipe();
		if (!s || s.axis !== "x") return;
		const v = -s.dx / Math.max(1, e.timeStamp - s.t);
		if (-s.dx > SWIPE_CLOSE_PX || v > SWIPE_CLOSE_V) onClose();
	};
	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "Tab") return;
		const panel = panelRef.current;
		if (!panel) return;
		const targets = Array.from(panel.querySelectorAll<HTMLElement>(
			"button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
		)).filter((target) => target.tabIndex >= 0 && !target.closest("[inert],[hidden],[aria-hidden='true']"));
		const first = targets[0];
		const last = targets[targets.length - 1];
		if (!first || !last) {
			e.preventDefault();
			panel.focus({ preventScroll: true });
		} else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
			e.preventDefault();
			last.focus({ preventScroll: true });
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus({ preventScroll: true });
		}
	};

	return createPortal(
		<div className="fixed inset-0 z-(--z-sheet)">
			<div
				aria-hidden="true"
				onClick={onClose}
				className={`absolute inset-0 bg-m-scrim transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label="导航"
				tabIndex={-1}
				onKeyDown={onKeyDown}
				onTouchStart={onTouchStart}
				onTouchMove={onTouchMove}
				onTouchEnd={onTouchEnd}
				onTouchCancel={resetSwipe}
				className={`absolute inset-y-0 left-0 flex w-full touch-pan-y flex-col bg-m-bg text-m-text outline-none transition-transform duration-300 ease-m-sheet ${
					visible ? "translate-x-0" : "-translate-x-full"
				}`}
				style={{ paddingTop: "var(--m-safe-top)", paddingBottom: "calc(var(--m-safe-bottom) + 6px)" }}
			>
				<header className="flex h-12 shrink-0 items-center gap-2 px-3">
					<AppMark size={24} />
					<span className="min-w-0 flex-1 text-m-md font-medium whitespace-nowrap">OMP</span>
					<IconButton variant="plain" size="sm" icon={<Search {...I} />} label="搜索会话" onClick={() => go(paths.search())} />
					<div className="relative">
						<IconButton variant="plain" size="sm" icon={<Bell {...I} />} label={badge > 0 ? `收件箱，${badge} 项待处理` : "收件箱"} onClick={() => go(paths.inbox())} />
						{badge > 0 && <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 rounded-m-pill bg-m-danger px-1 text-[10px] leading-4 text-m-bg">{badge > 99 ? "99+" : badge}</span>}
					</div>
					<IconButton variant="plain" size="sm" icon={<X {...I} />} label="关闭导航" onClick={onClose} />
				</header>

				<div className="shrink-0">
					<div className="flex flex-wrap gap-1 px-3">
						<button
							type="button"
							onClick={() => {
								onClose();
								onNewSession?.();
							}}
							className="flex min-h-11 w-full items-center gap-2.5 rounded-m-md bg-m-surface px-3 text-left text-m-md text-m-text transition-colors duration-(--m-dur-fast) active:bg-m-surface-2"
						>
							<SquarePen {...I} size={20} className="shrink-0 text-m-text-2" />
							<span className="whitespace-nowrap">发起新对话</span>
						</button>
						<button
							type="button"
							onClick={() => go(paths.schedules())}
							className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-m-md px-2 text-left text-m-sm text-m-text-2 transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover"
						>
							<Clock {...I} size={18} className="shrink-0 text-m-text-2" />
							<span className="whitespace-nowrap">定时任务</span>
						</button>
						<span aria-hidden="true" className="my-auto h-5 w-px shrink-0 bg-m-border" />
						<button
							type="button"
							onClick={() => go(paths.ideas())}
							className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-m-md px-2 text-left text-m-sm text-m-text-2 transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover"
						>
							<Lightbulb {...I} size={18} className="shrink-0 text-m-text-2" />
							<span className="whitespace-nowrap">灵感收件箱</span>
						</button>
					</div>

					<div className="flex flex-wrap items-center gap-x-2 px-3 py-1">
						<ModeSwitch />
						<Segmented label="视图" className="min-w-fit ml-auto whitespace-nowrap [&]:p-0.5 [&>button]:px-2 [&>button]:shadow-none" value={viewMode} options={VIEW_OPTIONS} onChange={setViewMode} />
					</div>
				</div>
				<div className="m-noscrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">

					{viewMode === "project" ? (
						<TreeView onMore={openActions} onOpen={openSession} />
					) : (
						<ChronologicalView onMore={openActions} onOpen={openSession} />
					)}
				</div>

				<nav aria-label="更多入口" className="flex shrink-0 items-center border-t border-m-border px-3">
					<button type="button" onClick={() => go(paths.settings())} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-m-md px-2 text-m-sm text-m-text-2 active:bg-m-surface-hover"><Settings size={18} strokeWidth={1.75} />设置</button>
					<span aria-hidden="true" className="h-5 w-px shrink-0 bg-m-border" />
					<button type="button" onClick={() => go(paths.quota())} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-m-md px-2 text-m-sm text-m-text-2 active:bg-m-surface-hover"><Gauge size={18} strokeWidth={1.75} />订阅与配额</button>
				</nav>
			</div>
			{node}
		</div>,
		document.body,
	);
}
