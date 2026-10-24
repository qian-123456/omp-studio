import { Search } from "lucide-react";
import { useT } from "../../stores/language";
import type { IdeaPhase, IdeasScope, ScopeOption } from "./ideasLogic";
import { ROUND_ICON } from "./ideaStyles";
import { ScopeMenu } from "./ScopeMenu";

const TAB_CONFIG: { id: IdeaPhase; labelKey: string }[] = [
	{ id: "pending", labelKey: "backlog.tabPending" },
	{ id: "running", labelKey: "backlog.tabRunning" },
	{ id: "review", labelKey: "backlog.tabReview" },
	{ id: "finished", labelKey: "backlog.tabFinished" },
	{ id: "trash", labelKey: "backlog.tabTrash" },
];

/** Layer 2 of the panel header: segmented status tabs + scope and search round buttons. */
export function StatusTabs({
	active,
	counts,
	scope,
	scopeOptions,
	searchOpen,
	searchActive,
	onChange,
	onScopeChange,
	onToggleSearch,
}: {
	active: IdeaPhase;
	counts: Record<IdeaPhase, number>;
	scope: IdeasScope;
	scopeOptions: ScopeOption[];
	searchOpen: boolean;
	/** A non-empty query/kind filter is applied. */
	searchActive: boolean;
	onChange: (phase: IdeaPhase) => void;
	onScopeChange: (scope: IdeasScope) => void;
	onToggleSearch: () => void;
}) {
	const { t } = useT();
	const on = "bg-[var(--bg-selected)] text-[var(--text)]";
	return (
		<div className="flex shrink-0 items-center gap-1.5">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-[var(--bg)] p-0.5" role="tablist">
				{TAB_CONFIG.map((tab) => {
					const isActive = active === tab.id;
					return (
						<button
							key={tab.id}
							type="button"
							role="tab"
							aria-selected={isActive}
							onClick={() => onChange(tab.id)}
							className={`flex min-w-0 flex-1 items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-1 py-1 text-[11px] transition-colors ${
								isActive ? `${on}` : "text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							{t(tab.labelKey)}
							<span className="text-[10px] opacity-70">{counts[tab.id]}</span>
						</button>
					);
				})}
			</div>
			<ScopeMenu scope={scope} options={scopeOptions} onChange={onScopeChange} />
			<button
				type="button"
				onClick={onToggleSearch}
				aria-pressed={searchOpen}
				title={t("backlog.searchTitle")}
				aria-label={t("backlog.searchAriaLabel")}
				className={`${ROUND_ICON} h-7 w-7 ${searchOpen || searchActive ? on : ""}`}
			>
				<Search className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
