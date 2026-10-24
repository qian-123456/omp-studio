/** "长期共性问题 Top 3" card for the global view, aggregated from doctor history. */
import { useMemo } from "react";
import type { SessionMeta } from "../../lib/contracts";
import { aggregateSystemicIssues } from "./doctor";
import { useDoctor } from "./doctorStore";
import { useT } from "../../stores/language";

export function SystemicIssuesCard({
	sessions,
	onSelect,
}: {
	sessions: Record<string, SessionMeta>;
	onSelect: (sessionId: string) => void;
}) {
	const { t, locale } = useT();
	const history = useDoctor((s) => s.history);
	const issues = useMemo(() => aggregateSystemicIssues(history), [history, locale]);

	return (
		<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
			<div className="mb-2 text-[11.5px] font-medium text-neutral-200">{t("doctor.cardTitle")}</div>
			{issues.length === 0 ? (
				<div className="text-[10.5px] leading-relaxed text-neutral-500">
					{t("doctor.emptyIssues")}
				</div>
			) : (
				<div className="space-y-2">
					{issues.map((it) => (
						<div
							key={`${it.scope}-${it.tag}`}
							className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2"
						>
							<div className="mb-0.5 flex items-center justify-between gap-1.5 text-[11px]">
								<div className="flex min-w-0 items-center gap-1.5">
									<span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-neutral-400">
										{it.scopeLabel}
									</span>
									<span className="min-w-0 break-words font-medium text-amber-400">{it.tag}</span>
								</div>
								<span className="shrink-0 font-mono text-[10px] text-neutral-400">×{it.count}</span>
							</div>
							{it.hint && <div className="mb-1 text-[10.5px] text-neutral-400">{it.hint}</div>}
							<div className="flex flex-wrap gap-1">
								{it.sessionIds.map((id) => (
									<button
										key={id}
										type="button"
										onClick={() => onSelect(id)}
										className="max-w-full break-all rounded border border-[var(--border)] px-1.5 py-0.5 text-left text-[10px] text-neutral-300 hover:bg-[var(--bg-hover)]"
										title={sessions[id]?.title ?? id}
									>
										{sessions[id]?.title || id.slice(0, 8)}
									</button>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
