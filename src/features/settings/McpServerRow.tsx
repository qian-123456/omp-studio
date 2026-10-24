/** One MCP server row: identity, status chips, endpoint, placement ("用在：") and actions. */

import { Pencil, Trash2 } from "lucide-react";
import { tNow, useT } from "../../stores/language";
import type { ReactNode } from "react";
import type { McpServerView } from "../../lib/contracts";
import { projectName, transportLabel } from "./mcpDraft";
import { Chip, IconButton } from "./ui";
import { Switch } from "./Switch";

const PILL_CLASS =
	"whitespace-nowrap rounded-full hairline px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";

export function serverEndpoint(view: McpServerView): string {
	const d = view.definition;
	const base = d.command ?? d.url ?? tNow("mcp.noCommandOrUrl");
	return d.args.length > 0 ? `${base} ${d.args.join(" ")}` : base;
}

export function McpServerRow({
	view,
	projectNames,
	current,
	busy,
	onToggle,
	onEdit,
	onDelete,
	onPickProjects,
	onAddToCurrent,
}: {
	view: McpServerView;
	/** project path → display name */
	projectNames: ReadonlyMap<string, string>;
	current: string | null;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onDelete: () => void;
	onPickProjects: () => void;
	onAddToCurrent: () => void;
}) {
	const { t } = useT();
	const d = view.definition;
	const nameOf = (p: string) => projectNames.get(p) ?? projectName(p);
	const custom = new Set(view.customProjects);
	const on = view.mode !== "off" && !view.denylisted;
	const keys = (list: { key: string }[]) => list.map((kv) => kv.key).join(t("settingsModels.listSep"));

	const projectChip = (p: string) => (
		<Chip
			key={p}
			tone={p === current ? "accent" : "neutral"}
			title={custom.has(p) ? t("mcp.customProjectConfig") : p}
		>
			{nameOf(p)}
			{custom.has(p) && <span className="opacity-70">{t("mcp.customBadge")}</span>}
		</Chip>
	);

	let placement: ReactNode;
	if (view.mode === "all") {
		placement = (
			<>
				<Chip tone="accent" title={t("mcp.allProjectsChipTitle")}>
					{t("mcp.allProjectsChip")}
				</Chip>
				{view.excludedProjects.length > 0 && (
					<>
						<span className="whitespace-nowrap text-[11px] text-[var(--text-dim)]">{t("mcp.exceptLabel")}</span>
						{view.excludedProjects.map(projectChip)}
					</>
				)}
			</>
		);
	} else if (view.mode === "projects") {
		placement = view.activeProjects.map(projectChip);
	} else {
		placement = (
			<>
				<Chip>{t("mcp.notUsedYet")}</Chip>
				{view.copyProjects.length > 0 && (
					<span className="text-[11px] text-[var(--text-dim)]">
						{t("mcp.previouslyUsedIn", { projects: view.copyProjects.map(nameOf).join(t("settingsModels.listSep")) })}
					</span>
				)}
			</>
		);
	}

	const canAddToCurrent = current !== null && !view.activeProjects.includes(current);

	return (
		<div
			data-mcp-server={view.name}
			className="flex items-start justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--bg-hover)]"
		>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="break-all text-[13px] font-medium text-[var(--text)]">{view.name}</span>
					<Chip
						title={
							d.transport === "stdio"
								? t("mcp.stdioDesc")
								: t("mcp.remoteDesc")
						}
					>
						{transportLabel(d.transport)}
					</Chip>
					{view.mode === "off" && <Chip tone="warning">{t("mcp.disabledBadge")}</Chip>}
					{view.denylisted && (
						<Chip tone="warning" title={t("mcp.denylistedTitle")}>
							{t("mcp.denylistedBadge")}
						</Chip>
					)}
					{d.error && <Chip tone="danger">{t("mcp.configErrorBadge")}</Chip>}
				</div>
				<div className="break-all font-mono text-xs text-[var(--text-dim)]">{serverEndpoint(view)}</div>
				{(d.env.length > 0 || d.headers.length > 0 || d.hasAuth || d.hasOauth) && (
					<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
						{d.env.length > 0 && <span title={t("mcp.secretHidden")}>{t("mcp.envKeys", { keys: keys(d.env) })}</span>}
						{d.headers.length > 0 && <span title={t("mcp.secretHidden")}>{t("mcp.headerKeys", { keys: keys(d.headers) })}</span>}
						{(d.hasAuth || d.hasOauth) && <span>{t("mcp.oauthBadge")}</span>}
					</div>
				)}
				{d.error && (
					<div className="select-text whitespace-pre-wrap break-all text-xs text-[var(--status-error)]">
						{d.error}
					</div>
				)}
				<div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="mcp-placement">
					<span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">{t("mcp.usedInLabel")}</span>
					{placement}
				</div>
				<div className="flex flex-wrap items-center gap-1.5 pt-1">
					<button type="button" className={PILL_CLASS} disabled={busy} onClick={onPickProjects}>
						{t("mcp.selectProjectsBtn")}
					</button>
					{canAddToCurrent && (
						<button type="button" className={PILL_CLASS} disabled={busy} onClick={onAddToCurrent}>
							{t("mcp.addToCurrentBtn")}
						</button>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<IconButton icon={Pencil} label={t("mcp.editServerAria", { name: view.name })} title={t("common.edit")} disabled={busy} onClick={onEdit} />
				<IconButton
					icon={Trash2}
					variant="danger"
					label={t("mcp.deleteServerAria", { name: view.name })}
					title={t("common.delete")}
					disabled={busy}
					onClick={onDelete}
				/>
				<span
					className="ml-2"
					title={
						on
							? t("mcp.switchTitleOn")
							: view.denylisted
								? t("mcp.switchTitleDenylisted")
								: t("mcp.switchTitlePaused")
					}
				>
					<Switch
						checked={on}
						disabled={busy}
						ariaLabel={t("mcp.enableServerAria", { name: view.name })}
						onChange={() => onToggle(!on)}
					/>
				</span>
			</div>
		</div>
	);
}
