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
				"group/card my-1 rounded-xl text-[12px] transition-colors",
				status === "running"
					? "bg-[#0A84FF]/5 hairline"
					: status === "error"
						? "bg-[#FF453A]/5 hairline"
						: "bg-[var(--bg-panel)]/60 hover:bg-[var(--bg-panel)] hairline",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="press-scale flex w-full items-center gap-2 px-2.5 py-1.5 text-left select-none rounded-xl"
			>
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-neutral-500 transition-all",
						open
							? "rotate-90 opacity-100"
							: "rotate-0 opacity-0 group-hover/card:opacity-100",
					)}
				/>
				{status === "running" ? (
					<Loader2 size={12} className="shrink-0 animate-spin text-[#0A84FF]" />
				) : status === "error" ? (
					<span className="shrink-0 text-[11px] font-bold leading-none text-[#FF453A]">
						✕
					</span>
				) : status === "called" ? (
					<Clock size={12} className="shrink-0 text-[#FF9F0A]" />
				) : (
					<ToolIcon size={12} className="shrink-0 text-neutral-400" />
				)}
				<span
					className={clsx(
						"shrink-0 font-medium",
						status === "error" ? "text-[#ff7b72]" : "text-neutral-200",
					)}
					title={name}
				>
					{toolTitle}
				</span>
				{detail && (
					<span className="truncate text-[11px] text-neutral-400">
						{detail}
					</span>
				)}
				{stat && (
					<span className="shrink-0 font-mono text-[10px] tabular-nums">
						<span className="text-[#30D158]">+{stat.adds}</span>{" "}
						<span className="text-[#FF453A]">-{stat.dels}</span>
					</span>
				)}
				{durationText && (
					<span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-400 tabular-nums">
						{durationText}
					</span>
				)}
			</button>
			{open && (
				<div className="space-y-2 hairline-t px-2.5 py-2 text-[11px]">
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
								className="press-scale absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-neutral-100 focus:opacity-100 group-hover/cmd:opacity-100"
								title="复制命令"
							>
								<Copy size={10} /> 复制
							</button>
							<pre className="overflow-x-auto rounded-xl bg-[var(--bg)] hairline px-2.5 py-1.5 font-mono text-[11px] text-[#FFD60A]/90">
								<span className="text-neutral-500 select-none">$ </span>{command}
							</pre>
						</div>
					)}

					{file && (
						<div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg)] hairline px-2.5 py-1.5 text-neutral-400">
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
								className="press-scale flex shrink-0 items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100"
								title={file.endsWith(".md") ? "在工作台打开文档" : "在系统程序中打开"}
							>
								<ExternalLink size={10} />
								{file.endsWith(".md") ? "打开文档" : "打开文件"}
							</button>
						</div>
					)}

					{diff && (
						<div className="rounded-xl hairline bg-[var(--bg)]/50 p-1.5">
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
								className="press-scale absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-neutral-100 focus:opacity-100 group-hover/out:opacity-100"
								title="复制输出"
							>
								<Copy size={10} /> 复制
							</button>
							<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--bg)] hairline px-2.5 py-2 font-mono text-[11px] text-neutral-300">
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
								className="press-scale absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-300 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-neutral-100 focus:opacity-100 group-hover/content:opacity-100"
								title="复制写入内容"
							>
								<Copy size={10} /> 复制
							</button>
							<pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--bg)] hairline px-2.5 py-2 font-mono text-[11px] text-neutral-300">
								{String(asObj(args).content)}
							</pre>
							</div>
						)}

					{args !== undefined &&
						!command &&
						!file &&
						name !== "write" && (
							<pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--bg)] hairline px-2.5 py-1.5 font-mono text-[11px] text-neutral-400">
								{JSON.stringify(args, null, 2)}
							</pre>
						)}
				</div>
			)}
		</div>
	);
}
