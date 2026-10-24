/**
 * Shared "where does this server load" picker: two radio cards (selected projects /
 * all projects) plus a project checklist. Used by the scope dialog, the server editor
 * and the import dialog.
 */

import clsx from "clsx";
import { AlertTriangle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../../stores/language";
import type { McpScope } from "../../lib/contracts";
import { scopeError } from "./mcpProjects";

export interface PickerProject {
	path: string;
	name: string;
	/** Linked git worktrees that mirror this project's config. */
	worktrees: number;
}

const SEARCH_THRESHOLD = 8;

const SMALL_PILL_CLASS =
	"whitespace-nowrap rounded-full hairline px-2 py-0.5 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]";

function ModeCard({
	checked,
	title,
	subtitle,
	onSelect,
}: {
	checked: boolean;
	title: string;
	subtitle?: string;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={checked}
			onClick={onSelect}
			className={clsx(
				"flex-1 rounded-xl border px-3 py-2 text-left transition-colors",
				checked
					? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
					: "border-[var(--border-divider)] hover:bg-[var(--bg-hover)]",
			)}
		>
			<div className="whitespace-nowrap text-[13px] font-medium text-[var(--text)]">{title}</div>
			{subtitle && <div className="mt-0.5 text-[11px] leading-4 text-[var(--text-dim)]">{subtitle}</div>}
		</button>
	);
}

export function McpScopePicker({
	projects,
	current,
	value,
	onChange,
	copiesHaveSecrets = false,
	disabled = false,
}: {
	projects: PickerProject[];
	current: string | null;
	value: McpScope;
	onChange: (next: McpScope) => void;
	/** The definition carries env/header values; copies would write them into project files. */
	copiesHaveSecrets?: boolean;
	disabled?: boolean;
}) {
	const { t } = useT();
	const [search, setSearch] = useState("");
	const checked = useMemo(() => new Set(value.projects), [value.projects]);
	const q = search.trim().toLowerCase();
	const visible = useMemo(
		() =>
			q
				? projects.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
				: projects,
		[projects, q],
	);
	const error = scopeError(value);

	const setMode = (allProjects: boolean) => {
		if (allProjects === value.allProjects) return;
		let next = value.projects;
		if (allProjects && next.length === 0) next = projects.map((p) => p.path);
		if (!allProjects && next.length === 0 && current) next = [current];
		onChange({ allProjects, projects: next });
	};
	const toggle = (path: string) => {
		const next = checked.has(path)
			? value.projects.filter((p) => p !== path)
			: projects.filter((p) => checked.has(p.path) || p.path === path).map((p) => p.path);
		onChange({ ...value, projects: next });
	};
	const setVisible = (on: boolean) => {
		const vis = new Set(visible.map((p) => p.path));
		const next = on
			? projects.filter((p) => checked.has(p.path) || vis.has(p.path)).map((p) => p.path)
			: value.projects.filter((p) => !vis.has(p));
		onChange({ ...value, projects: next });
	};

	return (
		<div className={clsx("space-y-2", disabled && "pointer-events-none opacity-60")}>
			<div role="radiogroup" aria-label={t("mcp.scopeRadioGroup")} className="flex flex-wrap gap-2">
				<ModeCard
					checked={!value.allProjects}
					title={t("mcp.onlySelectedTitle")}
					subtitle={t("mcp.onlySelectedSubtitle")}
					onSelect={() => setMode(false)}
				/>
				<ModeCard
					checked={value.allProjects}
					title={t("mcp.allProjectsTitle")}
					subtitle={t("mcp.allProjectsSubtitle")}
					onSelect={() => setMode(true)}
				/>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
				<span>{value.allProjects ? t("mcp.hintAllProjects") : t("mcp.hintSelectedProjects")}</span>
				<span className="flex items-center gap-1.5">
					<button type="button" className={SMALL_PILL_CLASS} onClick={() => setVisible(true)}>
						{t("mcp.selectAll")}
					</button>
					<button type="button" className={SMALL_PILL_CLASS} onClick={() => setVisible(false)}>
						{t("mcp.unselectAll")}
					</button>
				</span>
			</div>

			{projects.length > SEARCH_THRESHOLD && (
				<label className="flex items-center gap-1.5 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5">
					<Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-dim)]" />
					<input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("mcp.searchPlaceholder")}
						aria-label={t("mcp.searchAria")}
						className="w-full bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
					/>
				</label>
			)}

			<div className="max-h-56 overflow-y-auto rounded-xl hairline">
				{projects.length === 0 && (
					<div className="px-3 py-3 text-xs text-[var(--text-dim)]">{t("mcp.noProjectsYet")}</div>
				)}
				{projects.length > 0 && visible.length === 0 && (
					<div className="px-3 py-3 text-xs text-[var(--text-dim)]">{t("mcp.noMatchingProjects")}</div>
				)}
				{visible.map((p) => (
					<label
						key={p.path}
						className="flex cursor-pointer items-start gap-2.5 border-b border-[var(--border-divider)] px-3 py-2 last:border-b-0 hover:bg-[var(--bg-hover)]"
					>
						<input
							type="checkbox"
							checked={checked.has(p.path)}
							onChange={() => toggle(p.path)}
							aria-label={p.name}
							className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
						/>
						<span className="min-w-0 flex-1">
							<span className="flex flex-wrap items-center gap-1.5">
								<span className="text-[13px] text-[var(--text)]">{p.name}</span>
								{p.path === current && (
									<span className="whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-1.5 py-px text-[10px] font-medium text-[var(--accent)]">
										{t("mcp.currentProjectBadge")}
									</span>
								)}
								{p.worktrees > 0 && (
									<span className="whitespace-nowrap text-[11px] text-[var(--text-dim)]">
										{t("mcp.worktreesCount", { count: p.worktrees })}
									</span>
								)}
							</span>
							<span className="block break-all text-[11px] text-[var(--text-dim)]">{p.path}</span>
						</span>
					</label>
				))}
			</div>

			{error && (
				<div role="alert" className="text-[11px] text-[var(--status-error)]">
					{error}
				</div>
			)}
			{copiesHaveSecrets && !value.allProjects && value.projects.length > 0 && (
				<div className="flex items-start gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_9%,transparent)] px-2.5 py-2 text-[11px] leading-4 text-[var(--text-muted)]">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--status-warning)]" />
					<span>
						{t("mcp.secretWarning")}
					</span>
				</div>
			)}
		</div>
	);
}
