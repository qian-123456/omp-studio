import { Check, ChevronDown, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { useSessions } from "../../stores/sessions";
import { useT } from "../../stores/language";
import { useBacklog } from "./backlogStore";
import {
	CAPTURE_PROJECT_NONE,
	captureProjectOptions,
	projectDisplayName,
	resolveCaptureProject,
} from "./ideasLogic";

const AUTO = "__auto__";

/** 「归属项目」 pill (folder + name + chevron) for new ideas; the resolved choice is what `backlogAdd` persists. */
export function CaptureProjectSelect({
	currentProject,
	className = "",
}: {
	currentProject: string | null;
	className?: string;
}) {
	const { t } = useT();
	const pick = useBacklog((s) => s.captureProject);
	const setPick = useBacklog((s) => s.setCaptureProject);
	const workspaces = useSessions((s) => s.workspaces);
	const options = useMemo(() => captureProjectOptions(workspaces), [workspaces]);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);

	const resolved = resolveCaptureProject(pick, currentProject);
	const label = resolved ? projectDisplayName(resolved) : t("backlog.noProject");
	// A remembered project that is no longer a workspace must stay selectable.
	const extra =
		pick !== null && pick !== CAPTURE_PROJECT_NONE && !options.some((o) => o.path === pick) ? pick : null;
	const autoName = currentProject ? projectDisplayName(currentProject) : t("backlog.noProject");
	const value = pick === null ? AUTO : pick;

	const rows: { value: string; label: string }[] = [
		{ value: AUTO, label: t("backlog.followCurrentSession", { name: autoName }) },
		...options.map((o) => ({ value: o.path, label: o.name })),
		...(extra ? [{ value: extra, label: projectDisplayName(extra) }] : []),
		{ value: CAPTURE_PROJECT_NONE, label: t("backlog.noProjectAssigned") },
	];

	return (
		<>
			<button
				type="button"
				onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
				title={resolved ?? t("backlog.noProjectAssignedTitle")}
				aria-label={t("backlog.assignProjectAria", { label })}
				aria-haspopup="listbox"
				aria-expanded={anchor !== null}
				className={`inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 text-[12px] text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${className}`}
			>
				<Folder className="h-3.5 w-3.5 shrink-0" />
				<span className="min-w-0 truncate">{label}</span>
				<ChevronDown className="h-3 w-3 shrink-0" />
			</button>
			<FloatingLayer
				anchor={anchor}
				placement="bottom-start"
				layer="popover"
				ignoreRefs={[{ current: anchor }]}
				onDismiss={() => setAnchor(null)}
				role="listbox"
				aria-label={t("backlog.assignProject")}
				className="w-[240px] !bg-[var(--bg-panel)] py-1"
			>
				{rows.map((r) => (
					<button
						key={r.value}
						type="button"
						role="option"
						aria-selected={value === r.value}
						onClick={() => {
							setPick(r.value === AUTO ? null : r.value);
							setAnchor(null);
						}}
						className={`flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
							value === r.value ? "text-[var(--text)]" : "text-[var(--text-muted)]"
						}`}
					>
						<span className="min-w-0 break-words">{r.label}</span>
						{value === r.value && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
					</button>
				))}
			</FloatingLayer>
		</>
	);
}
