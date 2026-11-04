import { Archive, Check, GitFork, Mail, MessageSquare, Pin } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { relTime, sessionName } from "../../core/lib/format";
import { isDraftId, STATUS_LABEL } from "../../core/types";
import { confirm, toast } from "../../ui";
import { patchSession } from "./actions";
import { needsAttn, type TreeSession } from "./tree";
import { refreshAll } from "./treeStore";

/** Status dot colours; quiet statuses (idle, suspended, external) draw no dot. */
export const STATUS_DOT: Record<string, string> = {
	working: "bg-m-accent m-pulse",
	awaiting_approval: "bg-m-warn",
	awaiting_answer: "bg-m-warn",
	review: "bg-m-success",
	error: "bg-m-danger",
	interrupted: "bg-m-danger",
};

const LOUD = new Set(Object.keys(STATUS_DOT));

/** Second line of a row: only statuses that matter plus 未读 (「运行中 · 未读」); empty when nothing to say. */
export function statusLine(s: Pick<TreeSession, "status" | "unread">): string {
	const st = s.status || "idle";
	return [LOUD.has(st) ? STATUS_LABEL[st] || st : null, s.unread ? "未读" : null].filter(Boolean).join(" · ");
}

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 8;
const SWIPE_PX = 64;
const ACTION_WIDTH = 96;

/** A vertical gesture belongs to scrolling; only a committed horizontal axis owns the pointer. */
function useRowGesture(onLong: (() => void) | undefined, onSwipe: ((right: boolean) => void) | undefined) {
	const gesture = useRef<{ x: number; y: number; id: number; axis: "pending" | "horizontal" | "vertical"; revealed: boolean } | null>(null);
	const timer = useRef<number | undefined>(undefined);
	const consumed = useRef(false);
	const [offset, setOffset] = useState(0);
	const [revealed, setRevealed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const close = () => { setRevealed(false); setOffset(0); };
	const clearTimer = () => {
		window.clearTimeout(timer.current);
		timer.current = undefined;
	};
	useEffect(() => clearTimer, []);
	return {
		offset,
		revealed,
		dragging,
		close,
		consumed: () => consumed.current,
		handlers: {
			onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
				if (!e.isPrimary || e.button > 0) return;
				clearTimer();
				consumed.current = false;
				if (e.pointerType === "mouse") return;
				gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: "pending", revealed };
				if (onLong) timer.current = window.setTimeout(() => {
					timer.current = undefined;
					gesture.current = null;
					consumed.current = true;
					navigator.vibrate?.(10);
					onLong();
				}, LONG_PRESS_MS);
			},
			onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
				const g = gesture.current;
				if (!g || g.id !== e.pointerId) return;
				const dx = e.clientX - g.x, dy = e.clientY - g.y;
				if (Math.hypot(dx, dy) <= MOVE_CANCEL_PX) return;
				clearTimer();
				consumed.current = true;
				if (g.axis === "pending") {
					if (Math.abs(dy) >= Math.abs(dx)) g.axis = "vertical";
					else if (onSwipe && Math.abs(dx) > Math.abs(dy) * 1.3) {
						g.axis = "horizontal";
						setDragging(true);
						e.currentTarget.setPointerCapture?.(e.pointerId);
					}
				}
				if (g.axis !== "horizontal") return;
				e.preventDefault();
				e.stopPropagation();
				setOffset(Math.max(-ACTION_WIDTH, Math.min(g.revealed ? 0 : ACTION_WIDTH, dx + (g.revealed ? -ACTION_WIDTH : 0))));
			},
			onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
				clearTimer();
				const g = gesture.current;
				gesture.current = null;
				setDragging(false);
				if (!g || g.id !== e.pointerId || g.axis !== "horizontal") return;
				e.preventDefault();
				e.stopPropagation();
				const dx = e.clientX - g.x;
				if (g.revealed) {
					if (dx > 0) close();
					else setOffset(-ACTION_WIDTH);
				} else if (dx <= -SWIPE_PX) {
					setRevealed(true);
					setOffset(-ACTION_WIDTH);
				} else {
					setOffset(0);
					if (dx >= SWIPE_PX) onSwipe?.(true);
				}
			},
			onPointerCancel: () => { clearTimer(); const g = gesture.current; gesture.current = null; consumed.current = true; setDragging(false); setOffset(g?.revealed ? -ACTION_WIDTH : 0); },
			onContextMenu: (e: { preventDefault: () => void }) => {
				if (!onLong) return;
				e.preventDefault();
				clearTimer();
				gesture.current = null;
				if (consumed.current) return;
				consumed.current = true;
				onLong();
			},
		},
	};
}

function highlightedTitle(title: string, query: string | undefined): ReactNode {
	const tokens = [...new Set(query?.trim().split(/\s+/).filter(Boolean) ?? [])];
	if (!tokens.length) return title;
	const pattern = tokens.sort((a, b) => b.length - a.length).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
	return title.split(new RegExp(`(${pattern})`, "gi")).map((part, index) =>
		index % 2 ? <mark key={index} className="rounded-sm bg-m-accent-soft text-m-accent-soft-text">{part}</mark> : part,
	);
}

export interface SessionRowProps {
	s: TreeSession;
	depth?: number;
	current?: boolean;
	withSpine?: boolean;
	spineFirst?: boolean;
	spineLast?: boolean;
	highlightQuery?: string;
	/** The action sheet discloses the complete title. */
	onMore?: (s: TreeSession) => void;
	onOpen?: (s: TreeSession) => void;
}

/** Shared flat/tree row; metadata and swipe mutations always use the real session. */
export const SessionRow = memo(function SessionRow({ s, depth = 0, current, withSpine, spineFirst, spineLast, highlightQuery, onMore, onOpen }: SessionRowProps) {
	const st = s.status || "idle";
	const line = statusLine(s);
	const name = sessionName(s);
	const busy = useRef(false);
	const [pending, setPending] = useState(false);
	const swipe = async (right: boolean) => {
		if (busy.current || isDraftId(s.id)) return;
		busy.current = true;
		setPending(true);
		try {
			if (right) {
				await api("POST", `/left/inbox/${encodeURIComponent(s.id)}/unread`, { unread: !Boolean(s.unread) });
				await refreshAll();
				toast(s.unread ? "已标为已读" : "已标为未读", { kind: "success" });
			} else {
				if (!s.archived && needsAttn(s) && !(await confirm({ message: "该会话正在运行或等待回复，确定要归档吗？", confirmText: "归档", danger: true }))) return;
				await patchSession(s, { archived: !s.archived }, s.archived ? "已取消归档" : "已归档");
			}
		} catch (error) { toast(`操作失败：${errorMessage(error)}`, { kind: "error" }); }
		finally { busy.current = false; setPending(false); }
	};
	const gesture = useRowGesture(onMore ? () => onMore(s) : undefined, isDraftId(s.id) ? undefined : (right) => void swipe(right));
	return (
		<div data-session-row className="relative pr-2" style={{ marginLeft: 8 + depth * 12 }}>
			{withSpine && <span aria-hidden className="pointer-events-none absolute left-0 w-2" style={{ top: spineFirst ? -6 : 0, bottom: spineLast ? "50%" : 0 }}>
				<span className={`absolute inset-0 border-l border-(--m-tree-line) ${spineLast ? "rounded-bl-[6px] border-b" : ""}`} />
				{!spineLast && <span className="absolute left-0 w-2 border-t border-(--m-tree-line)" style={{ top: spineFirst ? "calc(50% + 3px)" : "50%" }} />}
			</span>}
			<div className={`relative ml-2 overflow-hidden rounded-m-pill ${gesture.offset ? "bg-m-surface" : ""}`}>
				{gesture.offset > 0 && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-1 px-3 text-m-xs whitespace-nowrap text-m-accent">
					{s.unread ? <Check size={16} /> : <Mail size={16} />}{s.unread ? "已读" : "未读"}
				</span>}
				{gesture.revealed && !gesture.dragging && (
					<button type="button" data-action="archive" aria-label={s.archived ? "取消归档" : "归档"} onClick={() => { gesture.close(); void swipe(false); }}
						className="absolute inset-y-0 right-0 flex min-h-11 w-24 items-center justify-center gap-1 rounded-m-pill bg-m-danger/15 px-2 text-m-xs font-medium whitespace-nowrap text-m-danger">
						<Archive size={16} className="shrink-0" />{s.archived ? "取消归档" : "归档"}
					</button>
				)}
				<button type="button" title={name} aria-current={current || undefined} aria-busy={pending || undefined}
					aria-label={line ? `${name}，${line}` : name}
					aria-description={[!isDraftId(s.id) ? "左滑显示归档按钮，右滑切换已读状态" : null, onMore ? "长按或按 Shift+F10 查看完整标题和会话操作" : null].filter(Boolean).join("；") || undefined}
					onKeyDown={(e) => { if (onMore && (e.key === "ContextMenu" || e.shiftKey && e.key === "F10")) { e.preventDefault(); onMore(s); } }}
					onClick={(e) => { if (e.detail > 0 && gesture.consumed() || busy.current) return; if (gesture.revealed) { gesture.close(); return; } if (onOpen) onOpen(s); else nav.push(paths.chat(s.id)); }}
					{...gesture.handlers}
					style={{ touchAction: "pan-y", transform: gesture.offset ? `translateX(${gesture.offset}px)` : undefined }}
					className={`relative flex min-h-11 w-full items-center gap-2 rounded-m-pill px-3 py-2 text-left select-none active:bg-m-surface-hover ${current ? "bg-m-surface font-semibold" : gesture.offset ? "bg-m-bg" : ""}`}
				>
					{s.kind === "side" ? <MessageSquare size={14} className="shrink-0 text-m-text-3" aria-label="旁聊" /> : (s.kind === "fork" || s.parentId) ? <GitFork size={14} className="shrink-0 text-m-text-3" aria-label="分支会话" /> : null}
					{s.pinned && <Pin size={13} className="shrink-0 text-m-text-3" aria-label="已置顶" />}
					<span className={`min-w-0 flex-1 truncate text-m-sm text-m-text ${s.unread ? "font-semibold" : ""}`}>{highlightedTitle(name, highlightQuery)}</span>
					{STATUS_DOT[st] && <span aria-hidden className={`size-1.5 shrink-0 rounded-m-pill ${STATUS_DOT[st]}`} />}
					{s.unread && <span aria-label="未读" className="size-1.5 shrink-0 rounded-m-pill bg-m-accent" />}
					<span className="shrink-0 text-m-xs whitespace-nowrap text-m-text-3 tabular-nums">{relTime(s.updatedAt)}</span>
				</button>
			</div>
		</div>
	);
});
