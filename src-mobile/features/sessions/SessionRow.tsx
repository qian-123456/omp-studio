import { Pin } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { nav, paths } from "../../core/nav";
import { relTime, sessionName } from "../../core/lib/format";
import { STATUS_LABEL } from "../../core/types";
import type { TreeSession } from "./tree";

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

const LINE_TONE: Record<string, string> = {
	awaiting_approval: "text-m-warn",
	awaiting_answer: "text-m-warn",
	error: "text-m-danger",
	interrupted: "text-m-danger",
	working: "text-m-accent",
};

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 8;

/** Long-press (touch) / right-click (mouse) → `onLong`; a long press swallows the following click. */
function useLongPress(onLong: (() => void) | undefined) {
	const st = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
	const fired = useRef(false);
	const cancel = () => {
		if (st.current) clearTimeout(st.current.t);
		st.current = null;
	};
	useEffect(() => cancel, []);
	if (!onLong) return { handlers: {}, consumed: () => false };
	return {
		handlers: {
			onPointerDown: (e: ReactPointerEvent) => {
				fired.current = false;
				if (e.pointerType === "mouse") return;
				cancel();
				st.current = {
					x: e.clientX,
					y: e.clientY,
					t: setTimeout(() => {
						st.current = null;
						fired.current = true;
						navigator.vibrate?.(10);
						onLong();
					}, LONG_PRESS_MS),
				};
			},
			onPointerMove: (e: ReactPointerEvent) => {
				const s = st.current;
				if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_CANCEL_PX) cancel();
			},
			onPointerUp: cancel,
			onPointerCancel: cancel,
			onContextMenu: (e: { preventDefault: () => void }) => {
				e.preventDefault();
				if (fired.current) return;
				cancel();
				fired.current = true;
				onLong();
			},
		},
		consumed: () => {
			const f = fired.current;
			fired.current = false;
			return f;
		},
	};
}

export interface SessionRowProps {
	s: TreeSession;
	depth?: number;
	current?: boolean;
	/** Long-press / right-click: the session's action sheet (its title shows the full name). */
	onMore?: (s: TreeSession) => void;
	/** Replaces the default tap action (open the chat). */
	onOpen?: (s: TreeSession) => void;
}

/**
 * Drawer session row: status dot, title (max two lines; the long-press sheet shows it in full), relative time,
 * and a quiet status line only when something is going on. Memoized on the session object.
 */
export const SessionRow = memo(function SessionRow({ s, depth = 0, current, onMore, onOpen }: SessionRowProps) {
	const st = s.status || "idle";
	const line = statusLine(s);
	const name = sessionName(s);
	const lp = useLongPress(onMore ? () => onMore(s) : undefined);
	return (
		<div className="px-2 [contain-intrinsic-size:auto_52px] [content-visibility:auto]" style={{ paddingLeft: 8 + depth * 16 }}>
			<button
				type="button"
				aria-current={current || undefined}
				aria-label={line ? `${name}，${line}` : name}
				aria-description={onMore ? "长按或按 Shift+F10 查看完整标题和会话操作" : undefined}
				onKeyDown={(e) => {
					if (onMore && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
						e.preventDefault();
						onMore(s);
					}
				}}
				onClick={() => {
					if (lp.consumed()) return;
					if (onOpen) onOpen(s);
					else nav.push(paths.chat(s.id));
				}}
				{...lp.handlers}
				className={`flex min-h-12 w-full items-start gap-3 rounded-m-md px-3 py-2.5 text-left select-none transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover ${
					current ? "bg-m-surface" : ""
				}`}
			>
				<span aria-hidden className="flex h-5 w-2.5 shrink-0 items-center justify-center">
					{STATUS_DOT[st] && <span className={`size-2 rounded-m-pill ${STATUS_DOT[st]}`} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-start gap-3">
						<span
							className={`${onMore ? "line-clamp-2" : ""} min-w-0 flex-1 text-m-sm break-words text-m-text ${s.unread ? "font-semibold" : ""}`}
						>
							{s.pinned && <Pin size={13} strokeWidth={1.75} className="mr-1 inline-block align-[-1px] text-m-text-3" aria-label="已置顶" />}
							{name}
						</span>
						<span className="shrink-0 pt-px text-m-xs whitespace-nowrap text-m-text-3">{relTime(s.updatedAt)}</span>
					</span>
					{line && <span className={`mt-0.5 block text-m-xs whitespace-nowrap ${LINE_TONE[st] ?? "text-m-text-3"}`}>{line}</span>}
				</span>
			</button>
		</div>
	);
});
