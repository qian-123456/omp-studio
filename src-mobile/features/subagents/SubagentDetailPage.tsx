import { AlertCircle, Check, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { compactNumber } from "../../core/lib/format";
import type { PageProps } from "../../core/nav";
import { normalizeTranscript } from "../../core/normalize";
import type { Item, ToolItem } from "../../core/types";
import { Chip } from "../../ui/Chip";
import { CodeBlock } from "../../ui/CodeBlock";
import { DiffView, looksLikeDiff } from "../../ui/DiffView";
import { EmptyState } from "../../ui/EmptyState";
import { Markdown } from "../../ui/Markdown";
import { PageHeader } from "../../ui/PageHeader";
import { PullToRefresh } from "../../ui/PullToRefresh";
import { Spinner } from "../../ui/Spinner";
import { BUCKET_TONE } from "./SubagentsPage";
import { elapsedMs, formatElapsed, rowLabel, statusBucket, statusText } from "./model";
import { useSubagentTranscript } from "./transcript";
import { useNow } from "./useNow";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="mb-4">
			<h2 className="mb-1.5 whitespace-nowrap text-m-xs font-semibold text-m-text-3">{title}</h2>
			{children}
		</section>
	);
}

function Collapsible({ title, defaultOpen = false, children }: { title: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-m-md border border-m-border bg-m-surface">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-m-sm text-m-text-2"
			>
				{open ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
				{title}
			</button>
			{open && <div className="border-t border-m-border p-3">{children}</div>}
		</div>
	);
}

export function argsText(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

function ToolCall({ tool }: { tool: ToolItem }) {
	const args = argsText(tool.args);
	const icon =
		tool.status === "running" ? (
			<Spinner size={14} className="text-m-accent" />
		) : tool.status === "error" ? (
			<AlertCircle size={16} className="text-m-danger" />
		) : (
			<Check size={16} className="text-m-success" />
		);
	return (
		<Collapsible
			title={
				<span className="flex min-w-0 flex-1 items-start gap-2">
					<Wrench size={14} className="mt-0.5 shrink-0 text-m-text-3" />
					<span className="whitespace-nowrap font-medium text-m-text">{tool.name}</span>
					{tool.intent && <span className="min-w-0 flex-1 break-words text-m-text-3">{tool.intent}</span>}
					<span className="ml-auto shrink-0 pt-0.5">{icon}</span>
				</span>
			}
		>
			<div className="flex flex-col gap-2">
				{args && <CodeBlock code={args} lang="参数" maxHeight={240} wrap />}
				{tool.result &&
					(looksLikeDiff(tool.result) ? (
						<DiffView diff={tool.result} />
					) : (
						<CodeBlock code={tool.result} lang={tool.status === "error" ? "错误" : "结果"} maxHeight={320} wrap />
					))}
				{!args && !tool.result && <div className="text-m-xs text-m-text-3">无内容</div>}
			</div>
		</Collapsible>
	);
}

const Message = ({ item }: { item: Item }) => {
	if (item.role === "system") {
		return item.text ? <div className="break-words rounded-m-md bg-m-surface px-3 py-2 text-m-xs text-m-text-3">{item.text}</div> : null;
	}
	if (item.role === "user") {
		return (
			<div className="ml-auto max-w-[90%] break-words rounded-m-lg bg-m-bubble-user-bg px-3 py-2 text-m-sm text-m-bubble-user-text">
				{item.text}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{item.thinking && (
				<Collapsible title={<span className="whitespace-nowrap">思考过程</span>}>
					<div className="whitespace-pre-wrap break-words text-m-sm text-m-text-2">{item.thinking}</div>
				</Collapsible>
			)}
			{item.text && <Markdown text={item.text} />}
			{item.tools.map((t) => (
				<ToolCall key={t.id} tool={t} />
			))}
		</div>
	);
};

function PromptBlock({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	const long = text.length > 400 || text.split("\n").length > 8;
	return (
		<div className="rounded-m-md border border-m-border bg-m-surface px-3 py-2">
			<div className={!open && long ? "max-h-40 overflow-hidden" : ""}>
				<Markdown text={text} />
			</div>
			{long && (
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					className="mt-1 flex min-h-11 items-center whitespace-nowrap text-m-sm font-medium text-m-accent"
				>
					{open ? "收起" : "展开全部"}
				</button>
			)}
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
		// The first user entry is the assignment, already shown as the prompt.
		const first = all.findIndex((i) => i.role === "user");
		return info?.prompt && first >= 0 ? all.filter((_, i) => i !== first) : all;
	}, [items, info?.prompt]);
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.text)?.text ?? "";
	const output = info?.output && info.output.trim() !== lastAssistant.trim() ? info.output : "";
	const elapsed = summary ? formatElapsed(elapsedMs(summary, now)) : "";

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title={label.primary} subtitle={summary ? statusText(summary.status) : undefined} />
			<PullToRefresh className="min-h-0 flex-1" onRefresh={refresh}>
				{!info && loading ? (
					<div className="flex justify-center py-12 text-m-text-3">
						<Spinner size={22} />
					</div>
				) : !info ? (
					<EmptyState title="加载失败" hint={error ?? "找不到这个子代理"} />
				) : (
					<div className="px-3 pb-8 pt-3">
						{error && <div className="mb-3 rounded-m-md bg-m-surface px-3 py-2 text-m-xs text-m-danger">刷新失败：{error}</div>}
						{bucket === "failed" && (
							<div className="mb-4 rounded-m-md border border-m-danger/30 bg-m-danger/10 p-3 text-m-sm text-m-danger">
								<div className="flex items-center gap-1.5 font-medium">
									<AlertCircle size={16} />
									<span>执行异常：{statusText(summary!.status)}</span>
								</div>
							</div>
						)}
						<div className="mb-4 flex flex-wrap items-center gap-2">
							<Chip tone={BUCKET_TONE[bucket]} icon={bucket === "running" ? <Spinner size={10} /> : undefined}>
								{statusText(summary!.status)}
							</Chip>
							{label.role && <Chip>{label.role}</Chip>}
							{summary!.model && <Chip>{summary!.model}</Chip>}
							{elapsed && <Chip>耗时 {elapsed}</Chip>}
							{!!summary!.tokens && <Chip>{compactNumber(summary!.tokens)} tok</Chip>}
							{!!summary!.requestCount && <Chip>{summary!.requestCount} 请求</Chip>}
							{!!summary!.toolCallCount && <Chip>{summary!.toolCallCount} 工具</Chip>}
							{!!summary!.cost && <Chip>${summary!.cost.toFixed(3)}</Chip>}
						</div>
						{label.description && label.primary !== label.description && (
							<p className="mb-4 break-words text-m-sm text-m-text-2">{label.description}</p>
						)}
						{info.prompt && (
							<Section title="提示词">
								<PromptBlock text={info.prompt} />
							</Section>
						)}
						<Section title="执行过程（工具与思考）">
							{messages.length === 0 ? (
								<div className="rounded-m-md bg-m-surface px-3 py-6 text-center text-m-sm text-m-text-3">
									{running ? "子代理刚启动，还没有输出" : "没有对话记录"}
								</div>
							) : (
								<div className="flex flex-col gap-3">
									{messages.map((m) => (
										<Message key={m.id} item={m} />
									))}
								</div>
							)}
						</Section>
						{!running && output && (
							<Section title="输出">
								<div className="rounded-m-md border border-m-border bg-m-surface px-3 py-2">
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
