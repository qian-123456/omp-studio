/**
 * Right-side slide-over with one subagent's full picture: assignment,
 * prompt, live/historical process transcript, final output. Data comes from
 * the merged AgentRow plus `subagent_transcript` incremental polling.
 */

import clsx from "clsx";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	CircleDollarSign,
	Clock,
	Coins,
	Copy,
	Cpu,
	ExternalLink,
	Gauge,
	Layers,
	Loader2,
	Send,
	Square,
	Tag,
	Timer,
	Wrench,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../../components/FloatingLayer";
import type { SubagentTranscript, TranscriptItem } from "../../../lib/contracts";
import { copyText, errMsg } from "../../../lib/dialogs";
import { useEscapeKey } from "../../../lib/hooks";
import { subagentTranscript } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Markdown } from "../markdown";
import { formatTokens } from "../sessionStats";
import { formatDurationCompact, formatShortModel } from "../turnGrouping";
import type { AgentRow } from "./merge";
import type { SubagentStatus } from "./types";

const ICON: Record<
	SubagentStatus,
	{ Icon: typeof Check; color: string; spin?: boolean }
> = {
	running: { Icon: Loader2, color: "var(--status-info)", spin: true },
	completed: { Icon: Check, color: "var(--status-success)" },
	failed: { Icon: X, color: "var(--status-error)" },
	pending: { Icon: Clock, color: "var(--status-warning)" },
	aborted: { Icon: Square, color: "var(--status-warning)" },
};

const STATUS_TEXT: Record<SubagentStatus, string> = {
	pending: "排队中",
	running: "运行中",
	completed: "已完成",
	failed: "失败",
	aborted: "已中止",
};

const SOURCE_TEXT: Record<string, string> = {
	bundled: "内置",
	user: "用户",
	project: "项目",
};

type Tab = "overview" | "prompt" | "process" | "output";
const TABS: { id: Tab; label: string }[] = [
	{ id: "overview", label: "概览" },
	{ id: "prompt", label: "提示词" },
	{ id: "process", label: "过程" },
	{ id: "output", label: "输出" },
];

const POLL_MS = 1500;

function CopyButton({ text, label }: { text: string; label: string }) {
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await copyText(text);
					toast.success("已复制");
				} catch (e) {
					toast.error(`复制失败: ${errMsg(e)}`);
				}
			}}
			className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
			title={label}
		>
			<Copy size={11} />
			{label}
		</button>
	);
}

/** Compact transcript tool call row with expandable output. */
function ToolRow({ item, output }: { item: TranscriptItem; output?: TranscriptItem }) {
	const [open, setOpen] = useState(false);
	const call = item.toolCalls?.[0];
	if (!call) return null;
	const intent = call.intent;
	const argSummary = argPreview(call.args);
	const outText = output?.toolResult?.text ?? "";
	const isErr = output?.toolResult?.isError;
	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--ghost-hover)]"
			>
				<ChevronRight
					size={11}
					className={clsx(
						"shrink-0 text-[var(--text-30)] transition-transform duration-150",
						open && "rotate-90",
					)}
				/>
				<span
					className={clsx(
						"shrink-0 font-mono text-[11px]",
						isErr ? "text-[var(--status-error)]" : "text-[var(--text-60)]",
					)}
				>
					{call.name}
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-30)]">
					{intent ?? argSummary}
				</span>
			</button>
			{open && outText && (
				<pre className="mx-1 mb-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-[11px] leading-5 text-[var(--text-40)]">
					{outText}
				</pre>
			)}
		</div>
	);
}

function argPreview(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args.slice(0, 80);
	const o = args as Record<string, unknown>;
	for (const k of ["path", "file", "filePath", "command", "pattern", "query"]) {
		if (typeof o[k] === "string") {
			const s = o[k] as string;
			return s.length > 80 ? `${s.slice(0, 80)}…` : s;
		}
	}
	const j = JSON.stringify(args);
	return j && j !== "{}" ? (j.length > 80 ? `${j.slice(0, 80)}…` : j) : "";
}

function StatCard({
	icon: StatIcon,
	label,
	value,
	wide,
}: {
	icon: typeof Check;
	label: string;
	value?: string;
	wide?: boolean;
}) {
	if (!value) return null;
	return (
		<div
			className={clsx(
				"rounded-[14px] border border-[var(--line)] bg-[var(--ghost-hover)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
				wide && "col-span-2",
			)}
		>
			<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-40)]">
				<StatIcon size={12} />
				{label}
			</div>
			<div className="mt-0.5 break-words text-[12.5px] font-medium text-[var(--text)]">{value}</div>
		</div>
	);
}

const GLASS_BTN =
	"grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--ghost-hover)] text-[var(--text-60)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] transition-colors hover:text-[var(--text)] disabled:opacity-30";
const CHIP =
	"rounded-full border border-[var(--line)] bg-[var(--ghost-hover)] px-2 py-0.5 text-[var(--text-60)]";

/// `<parent-stem>/<id>.jsonl` → `<dir>/<parent-stem>.jsonl`.
function deriveParentFile(agentFile: string): string | undefined {
	const sep = agentFile.lastIndexOf("/");
	if (sep < 0) return undefined;
	const dir = agentFile.slice(0, sep);
	const slash = dir.lastIndexOf("/");
	const parentDir = slash >= 0 ? dir.slice(0, slash) : "";
	const stem = dir.slice(slash + 1);
	return stem ? `${parentDir}/${stem}.jsonl` : undefined;
}

export function SubagentSheet({
	parentFile,
	row,
	context,
	onClose,
	onPrev,
	onNext,
}: {
	parentFile?: string;
	row: AgentRow;
	context?: string;
	onClose: () => void;
	/** Step to the previous / next subagent in tree order; undefined disables the arrow. */
	onPrev?: () => void;
	onNext?: () => void;
}) {
	const [tab, setTab] = useState<Tab>("overview");
	const [data, setData] = useState<SubagentTranscript | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [systemOpen, setSystemOpen] = useState(false);
	const [taskOpen, setTaskOpen] = useState(false);
	const nextByteRef = useRef(0);
	const itemsRef = useRef<TranscriptItem[]>([]);
	const [items, setItems] = useState<TranscriptItem[]>([]);
	const { Icon, color, spin } = ICON[row.status];

	useEscapeKey(onClose, true);

	const isLive = row.status === "running" || row.status === "pending";
	// subagent_transcript takes the PARENT session file. `row.filePath` is the
	// agent's own `<parent-stem>/<id>.jsonl`; derive the parent from it when
	// the caller could not resolve one.
	const file =
		parentFile ??
		(row.filePath ? deriveParentFile(row.filePath) : undefined);

	// Load the subagent transcript (systemPrompt/prompt/output/items) once per
	// open sheet; while the agent is live, keep tailing via nextByte so the
	// 过程 tab streams. Stops at a terminal status or when the file is gone.
	useEffect(() => {
		if (!file) return;
		let cancelled = false;
		let timer: number | undefined;
		nextByteRef.current = 0;
		itemsRef.current = [];
		setItems([]);
		const tick = async () => {
			try {
				const t = await subagentTranscript(file, row.id, nextByteRef.current);
				if (cancelled) return;
				setData(t);
				setError(null);
				if (t.reset) {
					itemsRef.current = [];
				}
				itemsRef.current = [...itemsRef.current, ...t.items];
				nextByteRef.current = t.nextByte;
				setItems(itemsRef.current);
				if (isLive) timer = window.setTimeout(tick, POLL_MS);
			} catch (e) {
				if (cancelled) return;
				setError(errMsg(e));
				if (isLive) timer = window.setTimeout(tick, POLL_MS);
			}
		};
		void tick();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
		// Only re-arm when the file/identity/liveness changes, not every tick.
	}, [file, row.id, isLive]);

	// Map toolCallId -> toolResult item for compact process rows.
	const callIds = useMemo(() => {
		const s = new Set<string>();
		for (const it of items) {
			for (const c of it.toolCalls ?? []) s.add(c.id);
		}
		return s;
	}, [items]);
	const resultsByCallId = useMemo(() => {
		const m = new Map<string, TranscriptItem>();
		for (const it of items) {
			if (it.kind === "tool_result" && it.toolResult?.toolCallId) {
				m.set(it.toolResult.toolCallId, it);
			}
		}
		return m;
	}, [items]);

	const statusText = STATUS_TEXT[row.status];
	const duration =
		row.durationMs !== undefined
			? formatDurationCompact(row.durationMs)
			: undefined;
	// Verbatim prompt: live/details task, else the first user message in the transcript.
	const taskPrompt = row.task ?? data?.prompt ?? undefined;
	// omp prefixes every subagent prompt with this; hide it in the "负责什么" summary.
	const assignmentText =
		row.assignment ?? taskPrompt?.replace(/^Complete assignment thoroughly:\s*/, "");
	const longTask = (assignmentText?.length ?? 0) > 360 || (assignmentText?.split("\n").length ?? 0) > 6;

	const outputText =
		data?.output ?? row.output ?? undefined;
	const outputPath = data?.outputPath ?? row.outputPath ?? undefined;

	const doReveal = async () => {
		if (!outputPath) return;
		try {
			await revealItemInDir(outputPath);
		} catch (e) {
			toast.error(`打开失败: ${errMsg(e)}`);
		}
	};

	return createPortal(
		<div
			className="fixed inset-0"
			style={{ zIndex: Z_LAYER.modal }}
			role="dialog"
			aria-modal="true"
			aria-label={`子代理 ${row.id}`}
		>
			{/* Very light dim; click closes */}
			<div className="absolute inset-0 bg-black/10" onMouseDown={onClose} />
			<aside
				className="liquid-glass sa-sheet-in absolute bottom-10 right-3 top-[52px] flex w-[min(560px,46vw)] flex-col text-[var(--text)]"
				onMouseDown={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex flex-col gap-2 px-4 pb-2.5 pt-3.5">
					<div className="flex items-center gap-2">
						<Icon
							size={15}
							className={clsx("shrink-0", spin && "animate-spin")}
							style={{ color }}
						/>
						<span className="min-w-0 flex-1 break-words text-[14px] font-bold" title={row.id}>
							{row.id.includes(".") ? row.id.split(".").join(" > ") : row.id}
						</span>
						{(onPrev || onNext) && (
							<>
								<button
									type="button"
									onClick={onPrev}
									disabled={!onPrev}
									aria-label="上一个子代理"
									title="上一个（↑）"
									className={GLASS_BTN}
								>
									<ChevronUp size={14} />
								</button>
								<button
									type="button"
									onClick={onNext}
									disabled={!onNext}
									aria-label="下一个子代理"
									title="下一个（↓）"
									className={GLASS_BTN}
								>
									<ChevronDown size={14} />
								</button>
							</>
						)}
						<button type="button" onClick={onClose} className={GLASS_BTN} aria-label="关闭" title="关闭（Esc）">
							<X size={14} />
						</button>
					</div>
					<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
						{row.agent && <span className={CHIP}>{row.agent}</span>}
						{row.model && <span className={CHIP} title={row.model}>{formatShortModel(row.model)}</span>}
						{row.thinkingLevel && <span className={CHIP}>{row.thinkingLevel}</span>}
						<span className={CHIP} style={{ color }}>
							{[statusText, duration].filter(Boolean).join(" · ")}
						</span>
					</div>
				</div>

				{/* Tabs: segmented pill with sliding highlight */}
				<div className="px-4 pb-2.5">
					<div className="relative grid grid-cols-4 rounded-full border border-[var(--line)] bg-[var(--ghost-hover)] p-0.5">
						<span
							aria-hidden
							className="sa-seg-thumb absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/4)] rounded-full bg-[var(--bg-active-fill)] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.15)]"
							style={{ transform: `translateX(${TABS.findIndex((t) => t.id === tab) * 100}%)` }}
						/>
						{TABS.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => setTab(t.id)}
								className={clsx(
									"relative rounded-full py-1 text-[12px] transition-colors",
									tab === t.id
										? "font-semibold text-[var(--text)]"
										: "text-[var(--text-40)] hover:text-[var(--text-60)]",
								)}
							>
								{t.label}
							</button>
						))}
					</div>
				</div>

				{/* Body */}
				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					{tab === "overview" && (
						<div className="space-y-4">
							{assignmentText && (
								<section className="rounded-[14px] border border-[var(--line)] bg-[var(--ghost-hover)] px-3 py-2.5">
									<div className="mb-1 flex items-center justify-between">
										<span className="text-[11px] text-[var(--text-40)]">负责什么</span>
										<CopyButton text={assignmentText} label="复制" />
									</div>
									<p
										className={clsx(
											"whitespace-pre-wrap break-words text-[12.5px] leading-5 text-[var(--text-60)]",
											!taskOpen && longTask && "line-clamp-6",
										)}
									>
										{assignmentText}
									</p>
									{longTask && (
										<button
											type="button"
											onClick={() => setTaskOpen(!taskOpen)}
											className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--ghost-hover)] px-2.5 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:text-[var(--text)]"
										>
											{taskOpen ? "收起" : "展开全文"}
											<ChevronRight size={11} className={clsx("transition-transform", taskOpen ? "-rotate-90" : "rotate-90")} />
										</button>
									)}
								</section>
							)}
							<section className="grid grid-cols-2 gap-2">
								<StatCard icon={Cpu} label="模型" value={row.model} wide />
								<StatCard icon={Brain} label="思考等级" value={row.thinkingLevel} />
								<StatCard icon={Tag} label="模型角色" value={row.modelRole} />
								<StatCard
									icon={Layers}
									label="来源"
									value={row.agentSource ? SOURCE_TEXT[row.agentSource] ?? row.agentSource : undefined}
								/>
								<StatCard
									icon={Wrench}
									label="工具次数"
									value={row.toolCount ? String(row.toolCount) : undefined}
								/>
								<StatCard
									icon={Send}
									label="请求数"
									value={row.requests ? String(row.requests) : undefined}
								/>
								<StatCard
									icon={Coins}
									label="Tokens"
									value={row.tokens ? formatTokens(row.tokens) : undefined}
								/>
								<StatCard
									icon={Gauge}
									label="上下文"
									value={
										row.contextTokens && row.contextWindow
											? `${Math.round((row.contextTokens / row.contextWindow) * 100)}%`
											: row.contextTokens
												? formatTokens(row.contextTokens)
												: undefined
									}
								/>
								<StatCard
									icon={CircleDollarSign}
									label="费用"
									value={
										typeof row.cost === "number" && Number.isFinite(row.cost)
											? `$${row.cost.toFixed(3)}`
											: undefined
									}
								/>
								<StatCard icon={Timer} label="用时" value={duration} />
							</section>
							{row.status === "running" && row.currentTool && (
								<section>
									<div className="mb-1 text-[11px] text-[var(--text-30)]">
										当前工具
									</div>
									<div className="font-mono text-[12px] text-[var(--text-60)]">
										↳ {row.currentTool}
										{row.currentToolDetail ? ` ${row.currentToolDetail}` : ""}
									</div>
								</section>
							)}
							{row.recentTools && row.recentTools.length > 0 && (
								<section>
									<div className="mb-1 text-[11px] text-[var(--text-30)]">
										最近工具
									</div>
									<div className="space-y-0.5">
										{row.recentTools.slice(-8).map((t, i) => (
											<div
												key={i}
												className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-40)]"
											>
												<span
													className={clsx(
														t.isError && "text-[var(--status-error)]",
													)}
												>
													{t.tool}
												</span>
												<span className="min-w-0 flex-1 truncate text-[var(--text-30)]">
													{t.intent ?? t.argsKey ?? argPreview(t.args)}
												</span>
											</div>
										))}
									</div>
								</section>
							)}
						</div>
					)}

					{tab === "prompt" && (
						<div className="space-y-4">
							<section>
								<div className="mb-1 flex items-center justify-between">
									<span className="text-[11px] text-[var(--text-30)]">
										任务提示词
									</span>
									{taskPrompt && (
										<CopyButton text={taskPrompt} label="复制" />
									)}
								</div>
								{taskPrompt ? (
									<pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-2 font-mono text-[11px] leading-5 text-[var(--text-60)]">
										{taskPrompt}
									</pre>
								) : (
									<p className="text-[12px] text-[var(--text-30)]">无提示词</p>
								)}
							</section>
							{context && (
								<section>
									<div className="mb-1 flex items-center justify-between">
										<span className="text-[11px] text-[var(--text-30)]">
											共享上下文
										</span>
										<CopyButton text={context} label="复制" />
									</div>
									<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-2 font-mono text-[11px] leading-5 text-[var(--text-40)]">
										{context}
									</pre>
								</section>
							)}
							{data?.systemPrompt && (
								<section>
									<button
										type="button"
										onClick={() => setSystemOpen(!systemOpen)}
										className="flex items-center gap-1 text-[11px] text-[var(--text-30)] transition-colors hover:text-[var(--text-60)]"
									>
										<ChevronRight
											size={11}
											className={clsx(
												"transition-transform duration-150",
												systemOpen && "rotate-90",
											)}
										/>
										系统提示词
									</button>
									{systemOpen && (
										<div className="mt-1">
											<div className="flex justify-end">
												<CopyButton
													text={data.systemPrompt}
													label="复制"
												/>
											</div>
											<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-2 font-mono text-[11px] leading-5 text-[var(--text-30)]">
												{data.systemPrompt}
											</pre>
										</div>
									)}
								</section>
							)}
						</div>
					)}

					{tab === "process" && (
						<div className="space-y-1">
							{!file && (
								<p className="text-[12px] text-[var(--text-30)]">
									会话文件不可用
								</p>
							)}
							{error && (
								<p className="text-[12px] text-[var(--status-error)]">
									{error}
								</p>
							)}
							{file && !error && items.length === 0 && (
								<p className="text-[12px] text-[var(--text-30)]">
									{isLive ? "等待子代理输出…" : "无过程记录"}
								</p>
							)}
							{items.map((it) => {
								if (it.kind === "assistant") {
									return (
										<div key={it.id} className="py-0.5">
											{it.toolCalls?.map((c) => (
												<ToolRow
													key={c.id}
													item={{ ...it, toolCalls: [c] }}
													output={resultsByCallId.get(c.id)}
												/>
											))}
											{it.text && <Markdown text={it.text} />}
										</div>
									);
								}
								if (it.kind === "tool_result") {
									// Rendered inline under its tool call; orphans show dimmed.
									if (callIds.has(it.toolResult?.toolCallId ?? "")) {
										return null;
									}
									return (
										<div
											key={it.id}
											className="flex items-center gap-1.5 px-1 font-mono text-[11px] text-[var(--text-30)]"
										>
											<span>{it.toolResult?.toolName}</span>
											<span className="min-w-0 flex-1 truncate">
												{it.toolResult?.text?.slice(0, 80)}
											</span>
										</div>
									);
								}
								return null;
							})}
						</div>
					)}

					{tab === "output" && (
						<div className="space-y-3">
							{outputText ? (
								(() => {
									const trimmed = outputText.trim();
									const looksJson =
										trimmed.startsWith("{") || trimmed.startsWith("[");
									if (looksJson) {
										try {
											return (
												<pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-2 font-mono text-[11px] leading-5 text-[var(--text-60)]">
													{JSON.stringify(JSON.parse(trimmed), null, 2)}
												</pre>
											);
										} catch {
											// fall through to markdown
										}
									}
									return <Markdown text={outputText} />;
								})()
							) : (
								<p className="text-[12px] text-[var(--text-30)]">
									{isLive ? "尚无输出" : "无输出"}
								</p>
							)}
							{outputPath && (
								<div className="flex items-center gap-2 border-t border-[var(--line)] pt-2">
									<span
										className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-30)]"
										title={outputPath}
									>
										{outputPath}
									</span>
									<button
										type="button"
										onClick={doReveal}
										className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
										title="在访达中显示"
									>
										<ExternalLink size={11} />
										显示
									</button>
									<CopyButton text={outputPath} label="复制路径" />
								</div>
							)}
						</div>
					)}
				</div>
			</aside>
		</div>,
		document.body,
	);
}
