/** [B] Collapsible tool card: header = intent/name/status; body = args-aware
 * rendering (bash command+output, read/grep/glob target, edit diff, write). */

import clsx from "clsx";
import {
	Clock,
	Copy,
	ExternalLink,
	Loader2,
	Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { openPath } from "@tauri-apps/plugin-opener";
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
	expanded,
	startedAt,
	endedAt,
}: {
	sessionId: string;
	name: string;
	args?: unknown;
	intent?: string | null;
	status: ToolStatus;
	output?: string;
	details?: unknown;
	expanded?: boolean;
	startedAt?: number;
	endedAt?: number;
}) {
	const [open, setOpen] = useState(status === "error" || expanded === true);
	const openDoc = useUi((s) => s.openDoc);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (status !== "running" || !startedAt) return;
		const id = setInterval(() => setNow(Date.now()), 200);
		return () => clearInterval(id);
	}, [status, startedAt]);

	let durationText: string | null = null;
	if (startedAt && endedAt) {
		const ms = Math.max(0, endedAt - startedAt);
		durationText = `${(ms / 1000).toFixed(1)}s`;
	} else if (status === "running" && startedAt) {
		const ms = Math.max(0, now - startedAt);
		durationText = `${(ms / 1000).toFixed(1)}s`;
	}
	useEffect(() => {
		if (expanded !== undefined) {
			setOpen(expanded);
		}
	}, [expanded]);

	useEffect(() => {
		if (status === "error") {
			setOpen(true);
		}
	}, [status]);
	const det = asObj(details);
	const diff = typeof det.diff === "string" ? det.diff : null;
	const file = pick(args, ["path", "file", "filePath"]);
	const command = pick(args, ["command"]);
	const isBash = name === "bash" || name === "shell";

	return (
		<div
			className={clsx(
				"my-0.5 rounded text-[12px] transition-all",
				status === "running"
					? "bg-sky-950/25 text-sky-200 border border-sky-500/30 animate-pulse"
					: status === "called"
						? "bg-amber-950/20 text-amber-200 border border-amber-600/30"
						: status === "error"
							? "bg-red-950/25 text-red-200 border border-red-500/30"
							: open
								? "bg-neutral-900/40 border border-neutral-800/60"
								: "hover:bg-neutral-800/40",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left select-none"
			>
				<span className="text-[10px] text-neutral-500 shrink-0 select-none">
					{open ? "▾" : "▸"}
				</span>
				{status === "running" ? (
					<Loader2 size={12} className="shrink-0 animate-spin text-sky-400" />
				) : status === "error" ? (
					<span className="shrink-0 text-[11px] font-bold text-red-400 leading-none">✕</span>
				) : status === "called" ? (
					<Clock size={12} className="shrink-0 text-amber-400" />
				) : (
					<span className="shrink-0 text-[11px] font-bold text-emerald-400 leading-none">✓</span>
				)}
				{isBash && <Terminal size={11} className="shrink-0 text-neutral-500" />}
				<span className="shrink-0 font-medium font-mono text-[11px] text-neutral-300">{name}</span>
				<span className="truncate text-neutral-400 text-[11px]">
					{headline(name, args, intent ?? null)}
				</span>
				{durationText && (
					<span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-neutral-500 shrink-0">
						<span>{durationText}</span>
					</span>
				)}
			</button>
			{open && (
				<div className="space-y-1.5 border-t border-neutral-800/40 px-2 py-1.5 text-[11px]">
					{command && (
						<div className="group/cmd relative">
							<button
								type="button"
								onClick={async () => {
									try {
										await copyText(command);
										toast.success("命令已复制");
									} catch (e) {
										toast.error(`复制失败: ${errMsg(e)}`);
									}
								}}
								className="absolute right-1 top-1 flex items-center gap-1 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-200 focus:opacity-100 group-hover/cmd:opacity-100"
								title="复制命令"
							>
								<Copy size={10} /> 复制
							</button>
							<pre className="overflow-x-auto rounded bg-neutral-950/80 border border-neutral-800/50 px-2 py-1 font-mono text-[11px] text-amber-200/90">
								<span className="text-neutral-500 select-none">$ </span>{command}
							</pre>
						</div>
					)}

					{file && (
						<div className="flex items-center justify-between gap-2 rounded bg-neutral-950/60 border border-neutral-800/40 px-2 py-1 text-neutral-400">
							<span className="truncate font-mono text-[11px] text-neutral-300" title={file}>
								{file}
							</span>
							<button
								type="button"
								onClick={async () => {
									try {
										if (file.endsWith(".md")) {
											openDoc(file);
										} else {
											await openPath(file);
										}
									} catch (e) {
										toast.error(`打开文件失败: ${errMsg(e)}`);
									}
								}}
								className="flex shrink-0 items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
								title={file.endsWith(".md") ? "在工作台打开文档" : "在系统程序中打开"}
							>
								<ExternalLink size={10} />
								{file.endsWith(".md") ? "打开文档" : "打开文件"}
							</button>
						</div>
					)}

					{diff && (
						<div className="rounded border border-neutral-800/60 p-1">
							<DiffView diff={diff} file={file} sessionId={sessionId} />
						</div>
					)}

					{output && (
						<div className="group/out relative">
							<button
								type="button"
								onClick={async () => {
									try {
										await copyText(output);
										toast.success("输出已复制");
									} catch (e) {
										toast.error(`复制失败: ${errMsg(e)}`);
									}
								}}
								className="absolute right-1 top-1 flex items-center gap-1 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-200 focus:opacity-100 group-hover/out:opacity-100"
								title="复制输出"
							>
								<Copy size={10} /> 复制
							</button>
							<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950/90 border border-neutral-800/50 px-2.5 py-1.5 font-mono text-[11px] text-neutral-300">
								{output}
							</pre>
						</div>
					)}

					{name === "write" &&
						typeof asObj(args).content === "string" &&
						!output && (
							<div className="group/content relative">
								<button
									type="button"
									onClick={async () => {
										try {
											await copyText(String(asObj(args).content));
											toast.success("内容已复制");
										} catch (e) {
											toast.error(`复制失败: ${errMsg(e)}`);
										}
									}}
									className="absolute right-1 top-1 flex items-center gap-1 rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-700 hover:text-neutral-200 focus:opacity-100 group-hover/content:opacity-100"
									title="复制写入内容"
								>
									<Copy size={10} /> 复制
								</button>
								<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950/90 border border-neutral-800/50 px-2.5 py-1.5 font-mono text-[11px] text-neutral-300">
									{String(asObj(args).content)}
								</pre>
							</div>
						)}

					{args !== undefined &&
						!command &&
						!file &&
						name !== "write" && (
							<pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-neutral-950/80 border border-neutral-800/40 px-2 py-1 font-mono text-[11px] text-neutral-500">
								{JSON.stringify(args, null, 2)}
							</pre>
						)}
				</div>
			)}
		</div>
	);
}
