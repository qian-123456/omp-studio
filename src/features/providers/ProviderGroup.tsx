import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import type { ProviderRow } from "../../lib/contracts";
import { useT } from "../../stores/language";
import { GROUP_PAGE_SIZE, type ProviderGroupId } from "./providerGroups";

const DOT: Record<ProviderGroupId, string> = {
	ready: "bg-emerald-400",
	needsKey: "bg-amber-400",
	disabled: "bg-neutral-500",
};

interface Props {
	id: ProviderGroupId;
	rows: ProviderRow[];
	open: boolean;
	onToggle: () => void;
	/** How many rows the user has asked to see (defaults to one page). */
	limit: number;
	onSetLimit: (n: number) => void;
	/** Rows that must stay visible even beyond `limit` (expanded / deep-linked). */
	pinnedId: string | null;
	/** Search active: show every match, no paging controls. */
	showAll: boolean;
	renderRow: (row: ProviderRow) => ReactNode;
}

/** Sidebar-style group: chevron header with a count chip, rows paged by "展开 N 条". */
export function ProviderGroup({ id, rows, open, onToggle, limit, onSetLimit, pinnedId, showAll, renderRow }: Props) {
	const { t } = useT();
	const title: Record<ProviderGroupId, string> = {
		ready: t("providers.groupReady"),
		needsKey: t("providers.groupNeedsKey"),
		disabled: t("providers.groupDisabled"),
	};
	const pinnedIdx = pinnedId ? rows.findIndex((r) => r.id === pinnedId) : -1;
	const visibleCount = showAll ? rows.length : Math.min(rows.length, Math.max(limit, pinnedIdx + 1));
	const hidden = rows.length - visibleCount;
	const canCollapse = !showAll && limit > GROUP_PAGE_SIZE && rows.length > GROUP_PAGE_SIZE;
	const Chevron = open ? ChevronDown : ChevronRight;

	return (
		<section data-group-key={`providers:${id}`} className="space-y-1">
			<button
				type="button"
				aria-expanded={open}
				onClick={onToggle}
				className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
			>
				<Chevron className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
				<span className={`h-2 w-2 shrink-0 rounded-full ${DOT[id]}`} />
				<span className="whitespace-nowrap font-bold">{title[id]}</span>
				<span className="whitespace-nowrap rounded-full border border-[var(--border-divider)] bg-[var(--well-bg)] px-1.5 text-[11px] tabular-nums text-neutral-400">
					{rows.length}
				</span>
			</button>
			{open && (
				<div className="space-y-1">
					{rows.slice(0, visibleCount).map((row) => (
						<div key={row.id} data-field-id={`provider:${row.id}`}>
							{renderRow(row)}
						</div>
					))}
					{(hidden > 0 || canCollapse) && (
						<div className="flex select-none items-center px-3 py-1 text-[11px] font-medium">
							<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
							{hidden > 0 && (
								<button
									type="button"
									onClick={() => onSetLimit(limit + GROUP_PAGE_SIZE)}
									className="flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
								>
									<Plus size={11} className="shrink-0" />
									<span>{t("providers.groupExpandCount", { count: Math.min(GROUP_PAGE_SIZE, hidden) })}</span>
								</button>
							)}
							{hidden > 0 && canCollapse && <span className="mx-1.5 text-[var(--text-dim)] opacity-40">｜</span>}
							{canCollapse && (
								<button
									type="button"
									onClick={() => onSetLimit(GROUP_PAGE_SIZE)}
									className="flex items-center gap-0.5 whitespace-nowrap rounded-md px-2 py-1 text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
								>
									<ChevronDown size={11} className="shrink-0 rotate-180" />
									<span>{t("providers.groupCollapse")}</span>
								</button>
							)}
							<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
						</div>
					)}
				</div>
			)}
		</section>
	);
}
