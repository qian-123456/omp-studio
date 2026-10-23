/**
 * Shared accessible header for sidebar groups and subgroups (S22, V2).
 * Real button with aria-expanded, Enter/Space support, and collapsed-only status bubbles.
 */

import { Loader2 } from "lucide-react";
import type React from "react";
import type { BranchSubgroup } from "./grouping";
import type { SessionMeta } from "../../lib/contracts";

export interface GroupStatusCounts {
	working: number;
	awaiting: number;
	error: number;
	unread: number;
}

/** Computes counts of attention/status sessions for a group or list of subgroups (R15) */
export function getGroupStatusCounts(
	sessions: SessionMeta[] | BranchSubgroup[],
): GroupStatusCounts {
	let working = 0;
	let awaiting = 0;
	let error = 0;
	let unread = 0;

	const check = (s: SessionMeta) => {
		if (s.status === "working") working++;
		else if (s.status === "awaiting_approval" || s.status === "awaiting_answer") awaiting++;
		else if (s.status === "error" || s.status === "interrupted") error++;
		// Unread and 待验收 are one concept (blue dot), counted once per session
		// and independent of status so a 待回复 + unread row keeps its bubble.
		if (s.unread || s.status === "review" || s.pending === "review") unread++;
	};

	for (const item of sessions) {
		if ("sessions" in item) {
			for (const s of item.sessions) check(s);
		} else {
			check(item);
		}
	}
	return { working, awaiting, error, unread };
}

/** Renders status bubbles per RFC palette (V2, R15) - only shown when group is collapsed */
export function StatusBubbles({ counts }: { counts: GroupStatusCounts }) {
	const hasAny =
		counts.working > 0 ||
		counts.awaiting > 0 ||
		counts.error > 0 ||
		counts.unread > 0;
	if (!hasAny) return null;

	return (
		<span className="flex items-center gap-1.5 ml-auto pl-1 pr-1 shrink-0">
			{counts.working > 0 && (
				<span
					title={`${counts.working} 个运行中会话`}
					className="inline-flex items-center gap-0.5 text-neutral-400 font-mono text-[10px] @max-[220px]:hidden"
				>
					<Loader2 size={10} className="animate-spin shrink-0" />
					<span>{counts.working}</span>
				</span>
			)}
			{counts.awaiting > 0 && (
				<span
					title={`${counts.awaiting} 个待回复会话`}
					className="inline-flex items-center gap-0.5 bg-sky-500/15 text-sky-400 px-1 py-0.2 rounded-full font-mono text-[10px] font-medium"
				>
					<span>{counts.awaiting}</span>
					<span className="@max-[220px]:hidden"> 待回复</span>
				</span>
			)}
			{counts.unread > 0 && (
				<span
					title={`${counts.unread} 个未读会话`}
					className="inline-flex items-center gap-1 text-blue-400 font-mono text-[10px] font-medium"
				>
					<span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
					<span>{counts.unread}</span>
				</span>
			)}
			{counts.error > 0 && (
				<span
					title={`${counts.error} 个异常或中断会话`}
					className="inline-flex items-center gap-1 text-red-400 font-mono text-[10px] font-medium"
				>
					<span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
					<span>{counts.error}</span>
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
	statusCounts?: GroupStatusCounts;
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
	statusCounts,
	actionButton,
	titleElement,
	onContextMenu,
	className,
	isSubgroup = false,
}: GroupHeaderProps) {
	return (
		<div
			data-group-key={groupKey}
			onContextMenu={onContextMenu}
			className={`group flex items-center justify-between mx-1 rounded-md transition-colors ${
				isSubgroup ? "px-1.5 py-1 text-[11px]" : "px-2 py-1.5 text-[12.5px]"
			} hover:bg-[var(--bg-hover)] text-[var(--text)] ${className ?? ""}`}
		>
			<button
				type="button"
				onClick={onToggle}
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
				{!isOpen && statusCounts && <StatusBubbles counts={statusCounts} />}
			</button>

			{actionButton && (
				<div className="flex items-center shrink-0 ml-1">
					{actionButton}
				</div>
			)}
		</div>
	);
}
