/** [B] Ephemeral slash-command output blocks (contract C3).
 * Rendered at the end of the thread by MessageList. omp `command_output`
 * frames and app-local results (e.g. the /status card) both land here. */

import clsx from "clsx";
import { type JSX, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useLive, type CommandOutputEntry } from "../../../stores/live";
import { Markdown } from "../markdown";

const COLLAPSED_MAX_H = 132;

export function CommandOutputList({
	sessionId,
}: {
	sessionId: string;
}): JSX.Element | null {
	const outputs = useLive((s) => s.sessions[sessionId]?.commandOutputs);
	const dismiss = useLive((s) => s.dismissCommandOutput);
	if (!outputs || outputs.length === 0) return null;
	return (
		<div className="mt-1 flex flex-col gap-1.5" data-command-outputs>
			{outputs.map((o) => (
				<OutputBlock
					key={o.id}
					entry={o}
					onDismiss={() => dismiss(sessionId, o.id)}
				/>
			))}
		</div>
	);
}

function OutputBlock({
	entry,
	onDismiss,
}: {
	entry: CommandOutputEntry;
	onDismiss(): void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = bodyRef.current;
		if (el) setOverflows(el.scrollHeight > COLLAPSED_MAX_H + 8);
	}, [entry.text]);

	const time = new Date(entry.ts).toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
	return (
		<div className="group/output rounded-[10px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] px-3 py-2">
			<div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--text-40,var(--text-dim))]">
				{entry.command && (
					<span className="font-mono text-[var(--text-60,var(--text-muted))]">
						/{entry.command}
					</span>
				)}
				<span>{time}</span>
				<button
					type="button"
					onClick={onDismiss}
					title="关闭"
					aria-label="关闭命令输出"
					className="ml-auto flex h-4 w-4 items-center justify-center rounded text-[var(--text-30,var(--text-dim))] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/output:opacity-100"
				>
					<X size={11} />
				</button>
			</div>
			<div
				ref={bodyRef}
				className={clsx(
					"overflow-hidden text-[12px] leading-5 text-[var(--text-60,var(--text-muted))]",
					!expanded && "max-h-[132px]",
				)}
			>
				<Markdown text={entry.text} />
			</div>
			{(overflows || expanded) && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-1 flex items-center gap-0.5 text-[11px] text-[var(--text-40,var(--text-dim))] hover:text-[var(--text)]"
				>
					<ChevronDown
						size={11}
						className={clsx(
							"transition-transform",
							expanded && "rotate-180",
						)}
					/>
					{expanded ? "收起" : "展开全部"}
				</button>
			)}
		</div>
	);
}
