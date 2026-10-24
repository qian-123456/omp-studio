import { Check, ListFilter } from "lucide-react";
import { useState } from "react";
import { useT } from "../../stores/language";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { IdeasScope, ScopeOption } from "./ideasLogic";
import { ROUND_ICON } from "./ideaStyles";

/** Funnel round button + dropdown to limit the list to one project (or all projects). */
export function ScopeMenu({
	scope,
	options,
	onChange,
}: {
	scope: IdeasScope;
	options: ScopeOption[];
	onChange: (scope: IdeasScope) => void;
}) {
	const { t } = useT();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const active = scope !== null;
	const rows: { value: IdeasScope; label: string; isCurrent: boolean; title?: string }[] = [
		{ value: null, label: t("backlog.allProjects"), isCurrent: false },
		...options.map((o) => ({ value: o.root, label: o.label, isCurrent: o.isCurrent, title: o.root })),
	];

	return (
		<>
			<button
				type="button"
				onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
				aria-haspopup="listbox"
				aria-expanded={anchor !== null}
				title={t("backlog.filterByProjectTitle")}
				aria-label={t("backlog.filterByProjectAriaLabel")}
				className={`${ROUND_ICON} h-7 w-7 ${
					active || anchor ? "bg-[var(--bg-selected)] text-[var(--text)]" : ""
				}`}
			>
				<ListFilter className="h-3.5 w-3.5" />
			</button>
			<FloatingLayer
				anchor={anchor}
				placement="bottom-end"
				layer="popover"
				ignoreRefs={[{ current: anchor }]}
				onDismiss={() => setAnchor(null)}
				role="listbox"
				aria-label={t("backlog.filterByProjectAriaLabel")}
				className="max-h-[320px] w-[220px] overflow-y-auto !bg-[var(--bg-panel)] py-1"
			>
				{rows.map((r) => {
					const selected = scope === r.value;
					return (
						<button
							key={r.value ?? "__all"}
							type="button"
							role="option"
							aria-selected={selected}
							title={r.title}
							onClick={() => {
								onChange(r.value);
								setAnchor(null);
							}}
							className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
								selected ? "text-[var(--text)]" : "text-[var(--text-muted)]"
							}`}
						>
							<span className="min-w-0 flex-1 break-words">{r.label}</span>
							{r.isCurrent && (
								<span className="shrink-0 rounded-full bg-[var(--bg-hover)] px-1.5 text-[10px] text-[var(--accent)]">
									{t("backlog.currentTag")}
								</span>
							)}
							{selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
						</button>
					);
				})}
			</FloatingLayer>
		</>
	);
}
