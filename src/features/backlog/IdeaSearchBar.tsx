import { Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { BacklogKind } from "../../lib/contracts";
import type { IdeaSearch } from "./ideasLogic";
import { KIND_META, KINDS } from "./ideaStyles";

/** Temporary layer under the tabs: pill input + 缺陷/想法 toggles. Esc or ✕ clears and closes. */
export function IdeaSearchBar({
	search,
	onChange,
	onClose,
}: {
	search: IdeaSearch;
	onChange: (next: IdeaSearch) => void;
	onClose: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const toggleKind = (k: BacklogKind) =>
		onChange({ ...search, kinds: search.kinds.includes(k) ? search.kinds.filter((x) => x !== k) : [...search.kinds, k] });

	return (
		<div className="flex shrink-0 items-center gap-1.5">
			<div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[var(--border-divider)] bg-[var(--bg)] px-2.5 py-1 focus-within:border-[var(--accent)]">
				<Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-dim)]" />
				<input
					ref={inputRef}
					value={search.query}
					onChange={(e) => onChange({ ...search, query: e.target.value })}
					data-idea-search=""
					placeholder="搜索想法内容"
					className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)]"
				/>
				<button
					type="button"
					onClick={onClose}
					title="清除并关闭搜索"
					aria-label="清除并关闭搜索"
					className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
				>
					<X className="h-3 w-3" />
				</button>
			</div>
			{KINDS.map((k) => {
				const meta = KIND_META[k];
				const Icon = meta.icon;
				const on = search.kinds.includes(k);
				return (
					<button
						key={k}
						type="button"
						aria-pressed={on}
						onClick={() => toggleKind(k)}
						className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
							on
								? `border-transparent ${meta.tone}`
								: "border-[var(--border-divider)] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
						}`}
					>
						<Icon className="h-3 w-3" />
						{meta.label}
					</button>
				);
			})}
		</div>
	);
}
