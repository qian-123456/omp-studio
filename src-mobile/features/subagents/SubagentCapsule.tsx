import { useMemo, useState } from "react";
import { nav, paths } from "../../core/nav";
import { BottomSheet, Button } from "../../ui";
import { buildTree, countRows, flattenTree } from "./model";
import type { Counts } from "./model";
import { useCapsuleVisible } from "./settings";
import { SubagentTree } from "./SubagentTree";
import { useWatchSubagents } from "./store";
import { useNow } from "./useNow";

const PARTS: readonly { key: keyof Counts; label: string }[] = [
	{ key: "running", label: "运行" },
	{ key: "queued", label: "排队" },
	{ key: "done", label: "完成" },
	{ key: "failed", label: "失败" },
];

/** "2 运行 · 5 完成": only the non-zero states, in a fixed order. */
export function capsuleText(c: Counts): string {
	return PARTS.filter((p) => c[p.key] > 0)
		.map((p) => `${c[p.key]} ${p.label}`)
		.join(" · ");
}

/** Dot colour of the capsule: the most urgent state wins. */
function dotClass(c: Counts): string {
	if (c.running > 0) return "bg-m-accent m-pulse";
	if (c.failed > 0) return "bg-m-danger";
	if (c.queued > 0) return "bg-m-text-3";
	return "bg-m-success";
}

/**
 * Small inline pill 「● 2 运行 · 5 完成」 (docs/MOBILE_DESIGN.md §4.5). The thread places it in a
 * sticky row of its own; it never positions itself. Hidden when the session has no subagents or
 * the desktop `capsuleVisible` setting is off. Tap opens the nested overview sheet; tap an agent
 * there for its full-screen detail page.
 */
export function SubagentCapsule({ sessionId }: { sessionId: string }) {
	const visible = useCapsuleVisible();
	const { rows } = useWatchSubagents(sessionId);
	const [sheetOpen, setSheetOpen] = useState(false);

	const c = countRows(rows);
	const now = useNow(c.running + c.queued > 0);
	const flat = useMemo(() => flattenTree(buildTree(rows)), [rows]);

	if (!visible || rows.length === 0) return null;

	const text = capsuleText(c);
	const finished = c.done + c.failed;
	const open = (path: string) => {
		setSheetOpen(false);
		nav.push(path);
	};

	return (
		<>
			<button
				type="button"
				aria-label={`子代理：${text}`}
				aria-haspopup="dialog"
				aria-expanded={sheetOpen}
				onClick={() => setSheetOpen(true)}
				className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-m-pill bg-m-surface px-3 text-m-xs font-medium whitespace-nowrap text-m-text-2 active:bg-m-surface-2"
			>
				<span aria-hidden className={`size-2 shrink-0 rounded-m-pill ${dotClass(c)}`} />
				<span className="truncate">{text}</span>
			</button>

			<BottomSheet
				open={sheetOpen}
				onClose={() => setSheetOpen(false)}
				title="子代理"
				subtitle={`已结束 ${finished} / ${rows.length}`}
				footer={
					<Button block onClick={() => open(paths.subagents(sessionId))}>
						查看全部子代理
					</Button>
				}
			>
				<div className="px-4 pt-2 pb-2">
					<p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 px-1 text-m-xs text-m-text-2">
						{PARTS.filter((part) => c[part.key] > 0).map((part) => (
							<span key={part.key} className="whitespace-nowrap">{c[part.key]} {part.label}</span>
						))}
					</p>
					<SubagentTree rows={flat} now={now} onOpen={(id) => open(paths.subagent(sessionId, id))} />
				</div>
			</BottomSheet>
		</>
	);
}
