/** [B] Codex-style tool row: a single muted text line (verb-first Chinese
 * label + dimmed mono object) with a chevron that fades in on hover and
 * rotates when open. The body expands below, indented ps-6. */

import { openPath } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { DiffView } from "./DiffView";

export type ToolStatus = "running" | "done" | "error" | "called";

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const pick = (args: unknown, keys: string[]): string | undefined => {
	const o = asObj(args);
	for (const k of keys) {
		if (typeof o[k] === "string" && o[k]) return o[k] as string;
	}
	return undefined;
};

const FILE_KEYS = ["path", "file", "filePath", "target_file"];
const QUERY_KEYS = ["pattern", "query", "q", "regex", "search_query"];
const DIR_KEYS = ["dir", "folder", "directory", "root"];

type ToolFamily =
	| "read"
	| "search"
	| "find"
	| "list"
	| "run"
	| "edit"
	| "write"
	| "todo"
	| "web"
	| "task"
	| "other";

const TOOL_FAMILY: Record<string, ToolFamily> = {
	read: "read",
	read_file: "read",
	grep: "search",
	search: "search",
	search_files: "search",
	rg: "search",
	glob: "find",
	find: "find",
	fd: "find",
	list: "list",
	ls: "list",
	list_files: "list",
	bash: "run",
	shell: "run",
	exec: "run",
	run: "run",
	command: "run",
	edit: "edit",
	edit_file: "edit",
	write: "write",
	write_file: "write",
	todo: "todo",
	todowrite: "todo",
	webfetch: "web",
	web_fetch: "web",
	web_search: "web",
	task: "task",
	agent: "task",
};

/** Verb-first labels per status, Codex-style ("正在读取" / "已读取" / "运行失败"). */
const VERBS: Record<ToolFamily, { doing: string; did: string; base: string }> = {
	read: { doing: "正在读取", did: "已读取", base: "读取" },
	search: { doing: "正在搜索", did: "已搜索", base: "搜索" },
	find: { doing: "正在查找", did: "已查找", base: "查找" },
	list: { doing: "正在列出", did: "已列出", base: "列出" },
	run: { doing: "正在运行", did: "已运行", base: "运行" },
	edit: { doing: "正在编辑", did: "已编辑", base: "编辑" },
	write: { doing: "正在写入", did: "已写入", base: "写入" },
	todo: { doing: "正在更新待办", did: "已更新待办", base: "更新待办" },
	web: { doing: "正在获取网页", did: "已获取网页", base: "获取网页" },
	task: { doing: "正在运行子代理", did: "已运行子代理", base: "子代理" },
	other: { doing: "正在调用工具", did: "已调用工具", base: "调用工具" },
};

function toolFamily(name: string): ToolFamily {
	return TOOL_FAMILY[name.toLowerCase()] ?? "other";
}

/** Human-readable detail (the dimmed object after the verb). */
function toolDetail(
	family: ToolFamily,
	name: string,
	args: unknown,
	intent: string | null,
): string {
	if (intent) return intent;
	switch (family) {
		case "run":
			return pick(args, ["command", "cmd"]) ?? "";
		case "search":
			return (
				pick(args, QUERY_KEYS) ??
				pick(args, [...FILE_KEYS, ...DIR_KEYS]) ??
				""
			);
		case "find":
		case "list":
			return (
				pick(args, [...QUERY_KEYS, ...FILE_KEYS, ...DIR_KEYS]) ?? ""
			);
		case "read":
		case "edit":
		case "write":
			return pick(args, FILE_KEYS) ?? "";
		case "web":
			return pick(args, ["url", "uri", "query"]) ?? "";
		case "todo":
			return "";
		case "task": {
			const desc = pick(args, ["task", "description", "name"]);
			return desc ?? "";
		}
		default: {
			const first = pick(args, [...FILE_KEYS, ...QUERY_KEYS]);
			if (first) return first;
			const json = JSON.stringify(args);
			if (!json || json === "{}") return "";
			return json.length > 60 ? `${json.slice(0, 60)}…` : name;
		}
	}
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

/** Hover-only ghost copy affordance for quiet blocks. */
function CopyGhostButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await copyText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch (e) {
					toast.error(`复制失败: ${errMsg(e)}`);
				}
			}}
			className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-30)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/copy:opacity-100"
			title={label}
			aria-label={label}
		>
			{copied ? (
				<Check size={11} className="text-[var(--status-success)]" />
			) : (
				<Copy size={11} />
			)}
		</button>
	);
}

/** Quiet bordered mono block used for command lines, output and payloads. */
function QuietMonoBlock({
	header,
	body,
	copyText: copyValue,
	copyLabel,
}: {
	header?: string;
	body: string;
	copyText?: string;
	copyLabel: string;
}) {
	return (
		<div className="group/copy overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)]">
			{header !== undefined && (
				<div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-2.5 py-1">
					<span className="truncate font-mono text-[11px] text-[var(--text-40)]">
						{header}
					</span>
					<CopyGhostButton text={copyValue ?? body} label={copyLabel} />
				</div>
			)}
			<div className="relative">
				{header === undefined && (
					<div className="absolute right-1 top-1">
						<CopyGhostButton text={copyValue ?? body} label={copyLabel} />
					</div>
				)}
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-2.5 py-1.5 font-mono text-[11px] leading-5 text-[var(--text-60)]">
					{body}
				</pre>
			</div>
		</div>
	);
}

export function toolActivityLabel(
	name: string,
	args: unknown,
	intent: string | null,
	status: ToolStatus,
): { verb: string; object: string } {
	const family = toolFamily(name);
	const verbs = VERBS[family];
	const verb =
		status === "error"
			? "运行失败"
			: status === "running"
				? verbs.doing
				: status === "done"
					? verbs.did
					: verbs.base;
	return { verb, object: toolDetail(family, name, args, intent) };
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
	startedAt: _startedAt,
	endedAt: _endedAt,
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
	const file = pick(args, FILE_KEYS);
	const command = pick(args, ["command", "cmd"]);
	const { verb, object } = toolActivityLabel(name, args, intent ?? null, status);
	const stat = diffStat(diff);

	const hasBody = Boolean(
		command ||
			file ||
			diff ||
			output ||
			(name === "write" && typeof asObj(args).content === "string") ||
			(args !== undefined && !command && !file),
	);

	return (
		<div className="group/tool my-px">
			<button
				type="button"
				onClick={() => hasBody && setOpen(!open)}
				className={clsx(
					"flex w-full items-center gap-1 rounded px-1 py-0.5 text-left select-none",
					hasBody ? "cursor-pointer" : "cursor-default",
				)}
				aria-expanded={hasBody ? open : undefined}
			>
				<ChevronRight
					size={12}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-all duration-150",
						open
							? "rotate-90 opacity-100"
							: "rotate-0 opacity-0 group-hover/tool:opacity-100",
					)}
				/>
				<span className="flex min-w-0 items-baseline gap-1.5">
					<span
						className={clsx(
							"shrink-0 text-[length:var(--chat-font-size)] leading-6 transition-colors",
							status === "running" && "shimmer-text",
							status === "error" && "text-[var(--status-error)]",
							status !== "running" &&
								status !== "error" &&
								"text-[var(--text-60)] group-hover/tool:text-[var(--text)]",
						)}
						title={name}
					>
						{verb}
					</span>
					{object && (
						<span
							className={clsx(
								"truncate font-mono text-[11px]",
								status === "running"
									? "shimmer-text"
									: "text-[var(--text-40)]",
							)}
						>
							{object}
						</span>
					)}
					{stat && status === "done" && (
						<span className="shrink-0 font-mono text-[10px] tabular-nums">
							<span className="text-[var(--status-success)]">
								+{stat.adds}
							</span>{" "}
							<span className="text-[var(--status-error)]">
								−{stat.dels}
							</span>
						</span>
					)}
				</span>
			</button>

			{open && hasBody && (
				<div className="flex flex-col gap-1.5 ps-6 pb-1 pt-0.5">
					{command && (
						<QuietMonoBlock
							header={`$ ${command}`}
							body={output?.trim() ? output : "无输出"}
							copyText={output?.trim() ? output : command}
							copyLabel={output?.trim() ? "复制输出" : "复制命令"}
						/>
					)}

					{!command && file && (
						<div className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1">
							<span
								className="truncate font-mono text-[11px] text-[var(--text-60)]"
								title={file}
							>
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
								className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--text-30)] transition-colors hover:text-[var(--text)]"
								title={
									file.endsWith(".md")
										? "在工作台打开文档"
										: "在系统程序中打开"
								}
							>
								{file.endsWith(".md") ? "打开文档" : "打开文件"}
							</button>
						</div>
					)}

					{diff && <DiffView diff={diff} file={file} sessionId={sessionId} />}

					{!command && output && (
						<QuietMonoBlock body={output} copyLabel="复制输出" />
					)}

					{name === "write" &&
						typeof asObj(args).content === "string" &&
						!output && (
							<QuietMonoBlock
								body={String(asObj(args).content)}
								copyLabel="复制写入内容"
							/>
						)}

					{args !== undefined && !command && !file && name !== "write" && (
						<QuietMonoBlock
							body={JSON.stringify(args, null, 2)}
							copyLabel="复制参数"
						/>
					)}
				</div>
			)}
		</div>
	);
}
