import { ChevronRight } from "lucide-react";
import { nav, paths } from "../../core/nav";
import { Spinner } from "../../ui/Spinner";
import { countRows } from "./model";
import { useCapsuleVisible } from "./settings";
import { useWatchSubagents } from "./store";

/** Slim pill under the chat header summarising the session's subagents; tap opens the full page. */
export function SubagentCapsule({ sessionId }: { sessionId: string }) {
	const visible = useCapsuleVisible();
	const { rows } = useWatchSubagents(sessionId);
	if (!visible || rows.length === 0) return null;
	const c = countRows(rows);
	return (
		<div className="flex shrink-0 justify-center px-3">
			<button
				type="button"
				aria-label="打开子代理列表"
				onClick={() => nav.push(paths.subagents(sessionId))}
				className="flex min-h-11 items-center active:opacity-70"
			>
				<span className="flex h-8 items-center gap-2 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-3 text-m-xs text-m-text-2">
					{c.running > 0 && <Spinner size={12} className="text-m-accent" />}
					<span className={c.running > 0 ? "text-m-accent" : ""}>运行中 {c.running}</span>
					<span aria-hidden>·</span>
					<span className={c.done > 0 ? "text-m-success" : ""}>完成 {c.done}</span>
					<span aria-hidden>·</span>
					<span className={c.failed > 0 ? "text-m-danger" : ""}>失败 {c.failed}</span>
					{c.queued > 0 && (
						<>
							<span aria-hidden>·</span>
							<span>等待 {c.queued}</span>
						</>
					)}
					<ChevronRight size={14} className="text-m-text-3" />
				</span>
			</button>
		</div>
	);
}
