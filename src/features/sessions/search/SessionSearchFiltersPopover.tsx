import clsx from "clsx";
import { Filter, RotateCcw } from "lucide-react";
import type { Workspace } from "../../../lib/contracts";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { NativeSelect } from "../../../components/NativeSelect";
import { useT } from "../../../stores/language";
import {
	countActiveFilters,
	DEFAULT_SEARCH_FILTERS,
	type SearchFilters,
	type SearchScopeFilter,
	type SearchTimeFilter,
} from "./searchModel";

export interface SessionSearchFiltersPopoverProps {
	anchor: HTMLElement | null;
	open: boolean;
	onClose: () => void;
	ignoreRefs?: Array<React.RefObject<HTMLElement | null>>;
	filters: SearchFilters;
	onFiltersChange: (next: SearchFilters) => void;
	workspaces: Workspace[];
}

export function SessionSearchFiltersPopover({
	anchor,
	open,
	onClose,
	ignoreRefs,
	filters,
	onFiltersChange,
	workspaces,
}: SessionSearchFiltersPopoverProps) {
	const { t } = useT();

	if (!open || !anchor) return null;

	const activeCount = countActiveFilters(filters);
	const projectWorkspaces = workspaces.filter((w) => w.kind !== "global");

	const scopeOptions: Array<{ value: SearchScopeFilter; label: string }> = [
		{ value: "all", label: t("sessions.filterScopeAll") },
		{ value: "project", label: t("sessions.filterScopeProject") },
		{ value: "universal", label: t("sessions.filterScopeUniversal") },
	];

	const timeOptions: Array<{ value: SearchTimeFilter; label: string }> = [
		{ value: "all", label: t("sessions.filterTimeAll") },
		{ value: "today", label: t("sessions.filterTimeToday") },
		{ value: "7days", label: t("sessions.filterTime7Days") },
		{ value: "30days", label: t("sessions.filterTime30Days") },
	];

	const handleClear = () => {
		onFiltersChange(DEFAULT_SEARCH_FILTERS);
	};

	return (
		<FloatingLayer
			anchor={anchor}
			placement="bottom-end"
			layer="popover"
			offset={6}
			onDismiss={onClose}
			ignoreRefs={ignoreRefs}
			className="w-72 select-none rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-3.5 text-xs shadow-2xl space-y-3"
		>
			<div className="flex items-center justify-between pb-1 border-b border-[var(--border-divider)]">
				<div className="flex items-center gap-1.5 font-medium text-[var(--text)]">
					<Filter size={13} className="text-neutral-400" />
					<span>{t("sessions.searchFiltersTitle")}</span>
				</div>
				{activeCount > 0 && (
					<button
						type="button"
						onClick={handleClear}
						className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-rose-400 transition-colors"
					>
						<RotateCcw size={11} />
						<span>{t("sessions.filterClear")}</span>
					</button>
				)}
			</div>

			{/* Scope */}
			<div className="space-y-1.5">
				<div className="text-[11px] font-medium text-neutral-400">
					{t("sessions.filterScope")}
				</div>
				<div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--well-bg)] p-0.5">
					{scopeOptions.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() =>
								onFiltersChange({
									...filters,
									scope: opt.value,
									projectId: opt.value === "universal" ? "all" : filters.projectId,
								})
							}
							className={clsx(
								"rounded-md py-1 text-center text-[11px] font-medium transition-colors",
								filters.scope === opt.value
									? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-xs"
									: "text-[var(--text-muted)] hover:text-[var(--text)]",
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Project */}
			<div className="space-y-1.5">
				<div className="text-[11px] font-medium text-neutral-400">
					{t("sessions.filterProject")}
				</div>
				<NativeSelect
					value={filters.projectId}
					disabled={filters.scope === "universal"}
					onChange={(e) =>
						onFiltersChange({
							...filters,
							projectId: e.target.value,
						})
					}
				>
					<option value="all">{t("sessions.filterProjectAll")}</option>
					{projectWorkspaces.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				</NativeSelect>
			</div>

			{/* Time Range */}
			<div className="space-y-1.5">
				<div className="text-[11px] font-medium text-neutral-400">
					{t("sessions.filterTimeRange")}
				</div>
				<div className="grid grid-cols-4 gap-1 rounded-lg bg-[var(--well-bg)] p-0.5">
					{timeOptions.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() =>
								onFiltersChange({
									...filters,
									timeRange: opt.value,
								})
							}
							className={clsx(
								"rounded-md py-1 text-center text-[11px] font-medium transition-colors",
								filters.timeRange === opt.value
									? "bg-[var(--bg-active-fill)] text-[var(--text)] shadow-xs"
									: "text-[var(--text-muted)] hover:text-[var(--text)]",
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Include Archived toggle */}
			<div className="flex items-center justify-between pt-2 border-t border-[var(--border-divider)]">
				<span className="text-[11px] text-neutral-300">
					{t("sessions.filterIncludeArchived")}
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={filters.includeArchived}
					onClick={() =>
						onFiltersChange({
							...filters,
							includeArchived: !filters.includeArchived,
						})
					}
					className={clsx(
						"relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
						filters.includeArchived ? "bg-indigo-500" : "bg-neutral-700",
					)}
				>
					<span
						className={clsx(
							"pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out mt-0.5",
							filters.includeArchived ? "translate-x-3.5" : "translate-x-0.5",
						)}
					/>
				</button>
			</div>
		</FloatingLayer>
	);
}
