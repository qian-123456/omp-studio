import { Search } from "lucide-react";
import type { IdeaPhase, IdeasScope, ScopeOption } from "./ideasLogic";
import { ROUND_ICON } from "./ideaStyles";
import { ScopeMenu } from "./ScopeMenu";

export const TAB_LABELS: { id: IdeaPhase; label: string }[] = [
	{ id: "pending", label: "待处理" },
	{ id: "running", label: "运行中" },
	{ id: "review", label: "待验收" },
	{ id: "finished", label: "已结束" },
	{ id: "trash", label: "废纸篓" },
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
	const on = "bg-[var(--bg-selected)] text-[var(--text)]";
	return (
		<div className="flex shrink-0 items-center gap-1.5">
			<div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-[var(--bg)] p-0.5" role="tablist">
				{TAB_LABELS.map((tab) => {
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
							{tab.label}
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
				title="搜索"
				aria-label="搜索"
				className={`${ROUND_ICON} h-7 w-7 ${searchOpen || searchActive ? on : ""}`}
			>
				<Search className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
