/** [B] Collapsible tool card: header = intent/name/status; body = args-aware
 * rendering (bash command+output, read/grep/glob target, edit diff, write). */

import clsx from "clsx";
import {
	Bot,
	ChevronRight,
	Clock,
	Copy,
	ExternalLink,
	FilePlus2,
	FileText,
	FolderOpen,
	Globe,
	ListTodo,
	Loader2,
	Pencil,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

/** Chinese titles per tool family (ZCode tool rows lead with these). */
const TOOL_TITLES: Record<string, string> = {
	bash: "终端",
	shell: "终端",
	read: "读取",
	edit: "编辑",
	write: "写入",
	grep: "搜索",
	glob: "查找",
	list: "列出文件",
	todo: "待办",
	todowrite: "待办",
	task: "子代理",
	agent: "子代理",
	webfetch: "网页",
};

const TOOL_ICONS: Record<string, LucideIcon> = {
	bash: Terminal,
	shell: Terminal,
	read: FileText,
	edit: Pencil,
	write: FilePlus2,
	grep: Search,
	glob: FolderOpen,
	list: FolderOpen,
	todo: ListTodo,
	todowrite: ListTodo,
	task: Bot,
	agent: Bot,
	webfetch: Globe,
};

/** Short summary for the collapsed header, per tool kind. */
function headline(args: unknown, intent: string | null): string {
	if (intent) return intent;
	const target = pick(args, ["path", "file", "filePath", "pattern", "command"]);
	if (target) return target.length > 80 ? `${target.slice(0, 80)}…` : target;
	return "";
}

/** +/- line counts from the unified diff detail string. */
function diffStat(diff: string | null): { adds: number; dels: number } | null {
	if (!diff) return null;
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) adds += 1;
		else if (line.startsWith("-") && !line.startsWith("---")) dels += 1;
	}
	return adds + dels > 0 ? { adds, dels } : null;
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
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [status, startedAt]);

	let durationText: string | null = null;
	if (startedAt && endedAt) {
		const ms = Math.max(0, endedAt - startedAt);
		durationText = `${Math.max(1, Math.ceil(ms / 1000))}s`;
	} else if (status === "running" && startedAt) {
		const ms = Math.max(0, now - startedAt);
		durationText = `${Math.max(1, Math.ceil(ms / 1000))}s`;
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
	const toolKey = name.toLowerCase();
	const ToolIcon = TOOL_ICONS[toolKey] ?? Wrench;
	const toolTitle = TOOL_TITLES[toolKey] ?? "工具调用";
	const detail = headline(args, intent ?? null);
	const stat = diffStat(diff);

	return (
		<div
			className={clsx(
				"group/card my-0.5 rounded text-[12px] transition-colors",
				status === "running"
					? "bg-sky-500/5"
					: status === "error"
						? "bg-red-500/5"
						: "hover:bg-neutral-800/40",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left select-none"
			>
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-neutral-600 transition-all",
						open
							? "rotate-90 opacity-100"
							: "rotate-0 opacity-0 group-hover/card:opacity-100",
					)}
				/>
				{status === "running" ? (
					<Loader2 size={12} className="shrink-0 animate-spin text-sky-400" />
				) : status === "error" ? (
					<span className="shrink-0 text-[11px] font-bold leading-none text-red-400">
						✕
					</span>
				) : status === "called" ? (
					<Clock size={12} className="shrink-0 text-amber-400" />
				) : (
					<ToolIcon size={12} className="shrink-0 text-neutral-500" />
				)}
				<span
					className={clsx(
						"shrink-0 font-medium",
						status === "error" ? "text-red-300" : "text-neutral-300",
					)}
					title={name}
				>
					{toolTitle}
				</span>
				{detail && (
					<span className="truncate text-[11px] text-neutral-500">
						{detail}
					</span>
				)}
				{stat && (
					<span className="shrink-0 font-mono text-[10px]">
						<span className="text-emerald-400">+{stat.adds}</span>{" "}
						<span className="text-red-400">-{stat.dels}</span>
					</span>
				)}
				{durationText && (
					<span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">
						{durationText}
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
