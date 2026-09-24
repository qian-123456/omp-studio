/** [B] Collapsible tool card: header = intent/name/status; body = args-aware
 * rendering (bash command+output, read/grep/glob target, edit diff, write). */

import clsx from "clsx";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Loader2,
	Terminal,
} from "lucide-react";
import { useState } from "react";
import { useUi } from "../../stores/ui";
import { DiffView } from "./DiffView";

export type ToolStatus = "running" | "done" | "error" | "called";

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const pick = (args: unknown, keys: string[]): string | undefined => {
	const o = asObj(args);
	for (const k of keys) {
		if (typeof o[k] === "string") return o[k] as string;
	}
	return undefined;
};

/** Short summary for the collapsed header, per tool kind. */
function headline(name: string, args: unknown, intent: string | null): string {
	if (intent) return intent;
	const target = pick(args, ["path", "file", "filePath", "pattern", "command"]);
	if (target) return target.length > 80 ? `${target.slice(0, 80)}…` : target;
	return name;
}

export function ToolCard({
	sessionId,
	name,
	args,
	intent,
	status,
	output,
	details,
}: {
	sessionId: string;
	name: string;
	args?: unknown;
	intent?: string | null;
	status: ToolStatus;
	output?: string;
	details?: unknown;
}) {
	const [open, setOpen] = useState(false);
	const openDoc = useUi((s) => s.openDoc);
	const det = asObj(details);
	const diff = typeof det.diff === "string" ? det.diff : null;
	const file = pick(args, ["path", "file", "filePath"]);
	const command = pick(args, ["command"]);
	const isBash = name === "bash" || name === "shell";

	return (
		<div
			className={clsx(
				"my-1 rounded-md border text-[12px]",
				status === "error"
					? "border-red-900/60 bg-red-950/20"
					: "border-neutral-800 bg-neutral-900/50",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
			>
				{open ? (
					<ChevronDown size={12} className="shrink-0 text-neutral-500" />
				) : (
					<ChevronRight size={12} className="shrink-0 text-neutral-500" />
				)}
				{status === "running" ? (
					<Loader2 size={12} className="shrink-0 animate-spin text-sky-400" />
				) : status === "error" ? (
					<AlertTriangle size={12} className="shrink-0 text-red-400" />
				) : (
					<CheckCircle2 size={12} className="shrink-0 text-emerald-500" />
				)}
				{isBash && <Terminal size={12} className="shrink-0 text-neutral-500" />}
				<span className="shrink-0 font-medium text-neutral-300">{name}</span>
				<span className="truncate text-neutral-500">
					{headline(name, args, intent ?? null)}
				</span>
			</button>
			{open && (
				<div className="border-t border-neutral-800/60 px-2 py-1.5">
					{command && (
						<pre className="mb-1 overflow-x-auto rounded bg-neutral-950 px-2 py-1 font-mono text-[11px] text-amber-200">
							$ {command}
						</pre>
					)}
					{file && (
						<div className="mb-1 flex items-center gap-2 text-neutral-400">
							<span className="truncate font-mono text-[11px]">{file}</span>
							{file.endsWith(".md") && (
								<button
									type="button"
									onClick={() => openDoc(file)}
									className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] hover:bg-neutral-700"
								>
									打开文档
								</button>
							)}
						</div>
					)}
					{diff ? (
						<DiffView diff={diff} file={file} sessionId={sessionId} />
					) : output ? (
						<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-300">
							{output}
						</pre>
					) : name === "write" && asObj(args).content ? (
						<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-300">
							{String(asObj(args).content)}
						</pre>
					) : args !== undefined && !command && !file ? (
						<pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-500">
							{JSON.stringify(args, null, 2)}
						</pre>
					) : null}
				</div>
			)}
		</div>
	);
}
