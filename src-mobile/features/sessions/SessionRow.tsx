import type { ReactNode } from "react";
import { MoreHorizontal, Pin } from "lucide-react";
import { memo } from "react";
import { nav, paths } from "../../core/nav";
import { relTime, sessionName } from "../../core/lib/format";
import { STATUS_LABEL } from "../../core/types";
import type { TreeSession } from "./tree";

const DOT: Record<string, string> = {
	working: "bg-m-accent animate-pulse",
	awaiting_approval: "bg-m-warn",
	awaiting_answer: "bg-m-warn",
	review: "bg-m-success",
	error: "bg-m-danger",
	interrupted: "bg-m-danger",
	suspended: "bg-m-text-3",
	external: "bg-m-text-3",
	idle: "bg-m-border",
};

/** One-line status text of a row: 「运行中 · 在线 · 未读」. */
export function statusLine(s: Pick<TreeSession, "status" | "live" | "unread">, extra?: string): string {
	const st = s.status || "idle";
	return [st !== "idle" ? STATUS_LABEL[st] || st : null, s.live ? "在线" : null, s.unread ? "未读" : null, extra || null]
		.filter(Boolean)
		.join(" · ");
}

export interface SessionRowProps {
	s: TreeSession;
	depth?: number;
	current?: boolean;
	onMore?: (s: TreeSession) => void;
	/** Replaces the default tap action (open the chat). */
	onOpen?: (s: TreeSession) => void;
	extra?: string;
	trailing?: ReactNode;
}

/** Memoized: re-renders only when this session's object (or the few flags) change. */
export const SessionRow = memo(function SessionRow({ s, depth = 0, current, onMore, onOpen, extra, trailing }: SessionRowProps) {
	const st = s.status || "idle";
	const warn = st === "awaiting_approval" || st === "awaiting_answer";
	const line = statusLine(s, extra);
	return (
		<div
			className={`flex min-h-14 items-stretch border-b border-m-border [contain-intrinsic-size:auto_60px] [content-visibility:auto] ${
				current ? "bg-m-surface-2" : ""
			}`}
			style={{ paddingLeft: 12 + depth * 12 }}
		>
			<button
				type="button"
				onClick={() => (onOpen ? onOpen(s) : nav.push(paths.chat(s.id)))}
				className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left active:bg-m-surface-hover"
			>
				<span aria-hidden className={`size-2.5 shrink-0 rounded-full ${DOT[st] ?? DOT.idle}`} />
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						{s.pinned && <Pin size={13} className="shrink-0 self-center text-m-text-3" aria-label="已置顶" />}
						<span className="min-w-0 flex-1 break-words text-m-md text-m-text">{sessionName(s)}</span>
						<span className="shrink-0 whitespace-nowrap text-m-xs text-m-text-3">{relTime(s.updatedAt)}</span>
					</span>
					{line && <span className={`mt-0.5 block text-m-xs ${warn ? "text-m-warn" : "text-m-text-3"}`}>{line}</span>}
				</span>
			</button>
			{trailing}
			{onMore && (
				<button
					type="button"
					aria-label="更多操作"
					onClick={() => onMore(s)}
					className="flex min-h-11 min-w-11 shrink-0 items-center justify-center self-center rounded-m-pill text-m-text-2 active:bg-m-surface-hover"
				>
					<MoreHorizontal size={20} />
				</button>
			)}
		</div>
	);
});
