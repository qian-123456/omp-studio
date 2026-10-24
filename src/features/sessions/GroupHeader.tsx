/**
 * Shared accessible header for sidebar groups and subgroups (S22, V2).
 * Real button with aria-expanded, Enter/Space support, and collapsed-only status bubbles.
 */

import { Loader2 } from "lucide-react";
import { useRef } from "react";
import type React from "react";
import type { BranchSubgroup } from "./grouping";
import type { SessionMeta } from "../../lib/contracts";
import { groupInbox } from "../inbox/attention";
import { useInboxWindow } from "../inbox/useInboxBadge";
import { useT } from "../../stores/language";

export interface GroupStatusCounts {
	working: number;
	/** Sessions that need the user: same set and time window as the inbox bell. */
	attention: number;
}

/**
 * Counts a group's working sessions and the ones that need the user. The
 * attention part reuses `groupInbox` (window, archived, CLI-only and
 * seen-awareness rules) so a collapsed header never disagrees with the bell:
 * raw `unread` / `error` flags are sticky on old transcripts and would show
 * permanent numbers the user cannot clear.
 */
export function getGroupStatusCounts(
	sessions: SessionMeta[] | BranchSubgroup[],
	now: number,
	windowHours: number,
): GroupStatusCounts {
	const flat: SessionMeta[] = [];
	for (const item of sessions) {
		if ("sessions" in item) flat.push(...item.sessions);
		else flat.push(item);
	}
	return {
		working: flat.filter((s) => s.status === "working").length,
		attention: groupInbox(flat, now, windowHours).badge,
	};
}

/** Status bubbles - only rendered when the group is collapsed */
export function StatusBubbles({ sessions }: { sessions: SessionMeta[] | BranchSubgroup[] }) {
	const { t } = useT();
	const { now, windowHours } = useInboxWindow();
	const counts = getGroupStatusCounts(sessions, now, windowHours);
	if (counts.working === 0 && counts.attention === 0) return null;

	return (
		<span className="flex items-center gap-1.5 ml-auto pl-1 pr-1 shrink-0">
			{counts.working > 0 && (
				<span
					title={t("sessions.workingSessionsCount", { count: counts.working })}
					className="inline-flex items-center gap-0.5 text-neutral-400 font-mono text-[10px] @max-[220px]:hidden"
				>
					<Loader2 size={10} className="animate-spin shrink-0" />
					<span>{counts.working}</span>
				</span>
			)}
			{counts.attention > 0 && (
				<span
					title={t("sessions.sessionsNeedAttention", { count: counts.attention })}
					className="inline-flex items-center gap-0.5 whitespace-nowrap bg-indigo-500/15 text-indigo-300 px-1.5 py-0.2 rounded-full font-mono text-[10px] font-medium"
				>
					<span>{counts.attention}</span>
					<span className="@max-[220px]:hidden"> {t("sessions.needsActionShort")}</span>
				</span>
			)}
		</span>
	);
}

export interface GroupHeaderProps {
	/** Unique key used for keyboard navigation and data-group-key */
	groupKey: string;
	title: string;
	icon: React.ReactNode;
	isOpen: boolean;
	onToggle: () => void;
	/** Sessions of this group; their status bubbles show while it is collapsed. */
	statusSessions?: SessionMeta[] | BranchSubgroup[];
	actionButton?: React.ReactNode;
	titleElement?: React.ReactNode;
	onContextMenu?: (e: React.MouseEvent) => void;
	className?: string;
	isSubgroup?: boolean;
}

export function GroupHeader({
	groupKey,
	title,
	icon,
	isOpen,
	onToggle,
	statusSessions,
	actionButton,
	titleElement,
	onContextMenu,
	className,
	isSubgroup = false,
}: GroupHeaderProps) {
	// The whole highlighted row toggles, not just the inner button: clicks on the
	// row padding / gap used to land on this div and silently do nothing. The
	// button's own click (mouse, Enter, Space) bubbles here; the action area is
	// excluded so its controls never also toggle the group.
	const actionsRef = useRef<HTMLDivElement>(null);
	return (
		<div
			data-group-key={groupKey}
			onContextMenu={onContextMenu}
			onClick={(e) => {
				if (e.target instanceof Node && actionsRef.current?.contains(e.target)) return;
				onToggle();
			}}
			className={`group flex items-center justify-between mx-1 rounded-md transition-colors ${
				isSubgroup ? "px-1.5 py-1 text-[11px]" : "px-2 py-1.5 text-[12.5px]"
			} hover:bg-[var(--bg-hover)] text-[var(--text)] ${className ?? ""}`}
		>
			<button
				type="button"
				aria-expanded={isOpen}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-left select-none overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)] rounded"
			>
				<span className="shrink-0 flex items-center">{icon}</span>
				{titleElement ?? (
					<span
						className={`font-bold truncate text-[var(--text)] min-w-[7ch] ${
							isSubgroup ? "font-mono text-[11px]" : "text-[12.5px]"
						}`}
						title={title}
					>
						{title}
					</span>
				)}
				{/* V2: Show status bubbles only when header is COLLAPSED */}
				{!isOpen && statusSessions && <StatusBubbles sessions={statusSessions} />}
			</button>

			{actionButton && (
				<div ref={actionsRef} className="flex items-center shrink-0 ml-1">
					{actionButton}
				</div>
			)}
		</div>
	);
}
