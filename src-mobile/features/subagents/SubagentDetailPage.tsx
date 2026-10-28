import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { compactNumber, copyText } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import { normalizeTranscript } from "../../core/normalize";
import type { Item, ToolItem } from "../../core/types";
import { Button, Chip, DiffView, EmptyState, IconButton, looksLikeDiff, Markdown, PageHeader, PullToRefresh, Spinner, toast } from "../../ui";
import { elapsedMs, formatElapsed, rowLabel, statusBucket, statusText } from "./model";
import { BUCKET_TONE } from "./SubagentTree";
import { useSubagentTranscript } from "./transcript";
import { useNow } from "./useNow";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="pt-6">
			<h2 className="px-4 pb-2 text-m-xs font-medium whitespace-nowrap text-m-text-3">{title}</h2>
			{children}
		</section>
	);
}

const card = "rounded-m-lg bg-m-surface";

export function argsText(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

async function copy(text: string): Promise<void> {
	const ok = await copyText(text);
	toast(ok ? "已复制" : "复制失败", { kind: ok ? "success" : "error" });
}

/** Labelled monospace block, full text wrapped, with a copy button. */
function MonoBlock({ label, text, danger = false }: { label: string; text: string; danger?: boolean }) {
	return (
		<div className="overflow-hidden rounded-m-md bg-m-code-bg">
			<div className="flex items-center justify-between pl-3.5">
				<span className={`text-m-xs font-medium whitespace-nowrap ${danger ? "text-m-danger" : "text-m-text-3"}`}>{label}</span>
				<IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={`复制${label}`} onClick={() => void copy(text)} />
			</div>
			<pre
				className={`m-selectable m-0 px-3.5 pb-3 font-m-mono text-m-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap ${danger ? "text-m-danger" : "text-m-text"}`}
			>
				{text}
			</pre>
		</div>
	);
}

function ToolRow({ tool }: { tool: ToolItem }) {
	const [open, setOpen] = useState(false);
	const args = argsText(tool.args);
	const error = tool.status === "error";
	const status =
		tool.status === "running" ? (
			<Spinner size={14} className="text-m-accent" />
		) : error ? (
			<AlertCircle size={18} strokeWidth={1.75} className="text-m-danger" />
		) : (
			<Check size={18} strokeWidth={1.75} className="text-m-success" />
		);
	return (
		<div className="m-list-row">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-start gap-3 pl-4 text-left active:bg-m-surface-hover"
			>
				<Wrench size={18} strokeWidth={1.75} className="mt-[15px] shrink-0 text-m-text-2" />
				<span className="m-list-sep flex min-h-13 min-w-0 flex-1 items-start gap-2 py-3.5 pr-4">
					<span className="min-w-0 flex-1 text-m-sm break-words">
						<span className="font-medium text-m-text">{tool.name}</span>
						{tool.intent && <span className="text-m-text-2"> {tool.intent}</span>}
					</span>
					<span className="flex shrink-0 items-center gap-1.5 pt-px text-m-text-3">
						{status}
						<span className="sr-only">{tool.status === "running" ? "运行中" : error ? "失败" : "已完成"}</span>
						{open ? <ChevronDown size={18} strokeWidth={1.75} /> : <ChevronRight size={18} strokeWidth={1.75} />}
					</span>
				</span>
			</button>
			{open && (
				<div className="flex flex-col gap-2 px-3 pb-3">
					{args && <MonoBlock label="参数" text={args} />}
					{tool.result &&
						(looksLikeDiff(tool.result) && !error ? (
							<DiffView diff={tool.result} />
						) : (
							<MonoBlock label={error ? "错误" : "结果"} text={tool.result} danger={error} />
						))}
					{!args && !tool.result && <p className="px-1 text-m-xs text-m-text-3">无内容</p>}
				</div>
			)}
		</div>
	);
}

function ToolSteps({ tools }: { tools: ToolItem[] }) {
	const [open, setOpen] = useState(false);
	const running = tools.some((tool) => tool.status === "running");
	const failed = tools.some((tool) => tool.status === "error");
	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="flex min-h-11 items-center gap-1 text-m-sm whitespace-nowrap text-m-text-3 active:opacity-60"
			>
				{running ? "正在运行" : "已运行"} {tools.length} 个步骤
				{failed && <span className="text-m-danger"> · 有失败</span>}
				{open ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}
			</button>
			{open && (
				<div className={`m-list mt-1 overflow-hidden ${card}`}>
					{tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}
				</div>
			)}
		</div>
	);
}

function Thinking({ text, running }: { text: string; running: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex min-h-11 items-center gap-1 text-m-sm whitespace-nowrap text-m-text-3 active:opacity-60"
			>
				<span className={running ? "m-shimmer" : undefined}>{running ? "思考中" : "思考过程"}</span>
				{open ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}
			</button>
			{open && (
				<div className="m-selectable mb-2 border-l-2 border-m-border pl-3 text-m-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-m-text-2">{text}</div>
			)}
		</div>
	);
}

function Message({ item, running }: { item: Item; running: boolean }) {
	if (item.role === "system") {
		return item.text ? <p className="px-1 text-m-xs break-words text-m-text-3">{item.text}</p> : null;
	}
	if (item.role === "user") {
		return (
			<div className="m-selectable ml-auto max-w-[85%] rounded-m-lg bg-m-bubble-user-bg px-[18px] py-3 text-m-md [overflow-wrap:anywhere] whitespace-pre-wrap text-m-text">
				{item.text}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			{item.thinking && <Thinking text={item.thinking} running={running && !item.text && item.tools.length === 0} />}
			{item.text && (
				<div className="m-selectable py-1">
					<Markdown text={item.text} />
				</div>
			)}
			{item.tools.length > 0 && <ToolSteps tools={item.tools} />}
		</div>
	);
}

function PromptCard({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const long = text.length > 400 || text.split("\n").length > 8;
	return (
		<div className={`${card} px-4 py-3`}>
			<div className={`m-selectable ${!open && long ? "max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}`}>
				<Markdown text={text} />
			</div>
			{long && (
				<Button variant="ghost" className="-ml-3 mt-1" onClick={() => setOpen((v) => !v)}>
					{open ? "收起" : "展开全部"}
				</Button>
			)}
		</div>
	);
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="m-list-row pl-4">
			<div className="m-list-sep flex min-h-12 items-start gap-4 py-3 pr-4">
				<span className="shrink-0 text-m-sm whitespace-nowrap text-m-text-2">{label}</span>
				<span className="min-w-0 flex-1 text-right text-m-sm break-all text-m-text">{children}</span>
			</div>
		</div>
	);
}

export function SubagentDetailPage({ route }: PageProps) {
	const { id: sessionId, agentId } = route.params;
	const { info, items, loading, error, refresh } = useSubagentTranscript(sessionId, agentId);
	const summary = info?.summary;
	const bucket = statusBucket(summary?.status);
	const running = !!summary && (bucket === "running" || bucket === "queued");
	const now = useNow(running);
	const label = rowLabel(summary ?? { id: agentId, status: "running" });
	const messages = useMemo(() => {
		const all = normalizeTranscript(items);
		// Hide only the assignment duplicated by the task card, never a later followup.
		const first = all.findIndex((i) => i.role === "user");
		return info?.prompt && first >= 0 && all[first].text.trim() === info.prompt.trim()
			? all.filter((_, i) => i !== first)
			: all;
	}, [items, info?.prompt]);
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.text)?.text ?? "";
	const rawOutput = info?.output?.trim() ?? "";
	const lastToolError = [...messages]
		.reverse()
		.flatMap((m) => [...m.tools].reverse())
		.find((t) => t.status === "error")?.result;
	// A failed agent's output (or its last tool error) is the error text, shown in full once.
	const errorText = bucket === "failed" ? rawOutput || lastToolError || "" : "";
	const output = rawOutput && rawOutput !== lastAssistant.trim() && rawOutput !== errorText ? rawOutput : "";
	const elapsed = summary ? formatElapsed(elapsedMs(summary, now)) : "";
	const usage = summary
		? [
				summary.tokens ? `${compactNumber(summary.tokens)} 词元` : "",
				summary.requestCount ? `${summary.requestCount} 次请求` : "",
				summary.toolCallCount ? `${summary.toolCallCount} 次工具调用` : "",
				summary.cost ? `$${summary.cost.toFixed(3)}` : "",
			].filter(Boolean)
		: [];

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="子代理详情" subtitle={summary ? [statusText(summary.status), elapsed].filter(Boolean).join(" · ") : undefined} />
			<PullToRefresh className="min-h-0 flex-1" onRefresh={refresh}>
				{!info && loading ? (
					<div className="flex justify-center py-12 text-m-text-3">
						<Spinner size={22} />
					</div>
				) : !info || !summary ? (
					<EmptyState title="加载失败" hint={error ?? "找不到这个子代理"} action={<Button onClick={() => void refresh()}>重新加载</Button>} />
				) : (
					<div className="px-4 pb-10">
						{error && <p className="px-1 pt-3 text-m-xs break-words text-m-danger">刷新失败：{error}</p>}

						{bucket === "failed" && (
							<div role="alert" className="mt-3 rounded-m-lg bg-m-danger-bg px-4 py-3.5 text-m-danger">
								<div className="flex items-center gap-2 text-m-md font-medium">
									<AlertCircle size={20} strokeWidth={1.75} />
									<span>{statusText(summary.status) === "已中止" ? "子代理已中止" : "子代理执行失败"}</span>
								</div>
								{errorText && (
									<pre className="m-selectable m-0 mt-2 font-m-mono text-m-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">{errorText}</pre>
								)}
							</div>
						)}

						<Section title="概览">
							<div className={`m-list overflow-hidden ${card}`}>
								<InfoRow label="名称">{label.primary}</InfoRow>
								<InfoRow label="状态">
									<Chip tone={BUCKET_TONE[bucket]}>{statusText(summary.status)}</Chip>
								</InfoRow>
								{label.role && <InfoRow label="角色">{label.role}</InfoRow>}
								{summary.model && (
									<InfoRow label="模型">
										{summary.model}
										{summary.thinkingLevel ? ` · ${summary.thinkingLevel}` : ""}
									</InfoRow>
								)}
								{elapsed && <InfoRow label="耗时">{elapsed}</InfoRow>}
								{usage.length > 0 && <InfoRow label="用量">{usage.join(" · ")}</InfoRow>}
								<InfoRow label="编号">
									<span className="font-m-mono text-m-xs">{summary.id}</span>
								</InfoRow>
							</div>
						</Section>

						{(info.prompt || label.description) && (
							<Section title="任务要求">
								<PromptCard text={info.prompt || label.description} />
							</Section>
						)}

						<Section title="执行过程">
							{messages.length === 0 ? (
								<div className={`${card} px-4 py-6 text-center text-m-sm text-m-text-3`}>
									{running ? "子代理刚启动，还没有输出" : "没有执行记录"}
								</div>
							) : (
								<div className="flex flex-col gap-4 px-1">
									{messages.map((m, index) => (
										<Message key={m.id} item={m} running={bucket === "running" && index === messages.length - 1} />
									))}
								</div>
							)}
						</Section>

						{!running && output && (
							<Section title="产出">
								<div className={`${card} m-selectable px-4 py-3`}>
									<Markdown text={output} />
								</div>
							</Section>
						)}
					</div>
				)}
			</PullToRefresh>
		</div>
	);
}
