/** Settings ▸ 系统提示词构成: what a brand-new empty session carries in context, with optimization hints. */
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeSelect } from "../../../components/NativeSelect";
import type { PromptCategory, PromptCategoryId, PromptComposition, PromptHint, PromptItem } from "../../../lib/contracts";
import { createSession } from "../../../lib/createSession";
import { errMsg } from "../../../lib/dialogs";
import { promptCompositionProbe } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useComposer } from "../../../stores/composer";
import { usePromptComposition } from "../../../stores/promptComposition";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { Button, Chip, Notice, SectionHeader, SettingsCard } from "../ui";
import { OmpSections } from "../OmpSettingsList";
import {
	buildOptimizePrompt,
	fmtTokens,
	nonEmptyCategories,
	pickInitialCwd,
	projectOptions,
	sharePct,
} from "./promptComposition";

/** Token-based category palette (no hard-coded hues; follows the active theme). */
const CATEGORY_COLOR: Record<PromptCategoryId, string> = {
	system: "var(--accent)",
	rules: "var(--status-warning)",
	skills: "var(--status-success)",
	tools: "var(--accent-strong)",
	mcp: "color-mix(in srgb, var(--accent) 45%, var(--text-dim))",
	other: "var(--text-dim)",
};

function ItemRow({
	item,
	total,
	open,
	onToggle,
}: {
	item: PromptItem;
	total: number;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<div data-prompt-item={item.id}>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
			>
				{open ? <ChevronDown size={13} className="mt-0.5 shrink-0" /> : <ChevronRight size={13} className="mt-0.5 shrink-0" />}
				<span className="min-w-0 flex-1">
					<span className="block break-all text-xs text-neutral-200">{item.title}</span>
					{item.detail && <span className="block break-all text-[11px] text-neutral-500">{item.detail}</span>}
				</span>
				<span className="shrink-0 font-mono text-[11px] text-neutral-400">
					约 {fmtTokens(item.tokens)} · {sharePct(item.tokens, total).toFixed(1)}%
				</span>
			</button>
			{open && (
				<pre className="mx-3 mb-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-active-fill)] p-2.5 font-mono text-[11px] leading-4 text-neutral-300 select-text">
					{item.text}
				</pre>
			)}
		</div>
	);
}

function CategoryCard({
	category,
	total,
	open,
	onToggle,
	openItems,
	onToggleItem,
}: {
	category: PromptCategory;
	total: number;
	open: boolean;
	onToggle: () => void;
	openItems: ReadonlySet<string>;
	onToggleItem: (id: string) => void;
}) {
	return (
		<div data-prompt-category={category.id} className="overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]"
			>
				{open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
				<span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[category.id] }} />
				<span className="min-w-0 flex-1 text-xs font-medium text-neutral-100">{category.label}</span>
				<Chip>{category.items.length} 项</Chip>
				<span className="shrink-0 font-mono text-[11px] text-neutral-300">
					约 {fmtTokens(category.tokens)} · {sharePct(category.tokens, total).toFixed(1)}%
				</span>
			</button>
			{open && (
				<div className="divide-y divide-[var(--border-divider)] border-t border-[var(--border-divider)]">
					{category.items.map((item) => (
						<ItemRow
							key={item.id}
							item={item}
							total={total}
							open={openItems.has(item.id)}
							onToggle={() => onToggleItem(item.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function HintRow({ hint, onLocate }: { hint: PromptHint; onLocate: (ids: string[]) => void }) {
	const [quoteOpen, setQuoteOpen] = useState(false);
	return (
		<div className="space-y-1.5 px-3 py-2.5">
			<div className="flex items-start gap-2">
				<Chip tone={hint.severity === "warn" ? "warning" : "neutral"}>{hint.severity === "warn" ? "建议处理" : "参考"}</Chip>
				<div className="min-w-0 flex-1">
					<div className="break-words text-xs font-medium text-neutral-100">{hint.title}</div>
					<div className="break-words text-[11px] leading-4 text-neutral-400">{hint.detail}</div>
				</div>
				{hint.itemIds.length > 0 && (
					<Button size="sm" onClick={() => onLocate(hint.itemIds)} className="shrink-0">
						查看相关项
					</Button>
				)}
			</div>
			{hint.quote && (
				<div>
					<button type="button" onClick={() => setQuoteOpen((v) => !v)} className="text-[11px] text-[var(--accent)] hover:underline">
						{quoteOpen ? "收起重复内容" : "查看重复内容"}
					</button>
					{quoteOpen && (
						<pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-active-fill)] p-2.5 font-mono text-[11px] leading-4 text-neutral-300 select-text">
							{hint.quote}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}

export function PromptCompositionSection() {
	const workspaces = useSessions((s) => s.workspaces);
	const requestedCwd = usePromptComposition((s) => s.requestedCwd);
	const requestId = usePromptComposition((s) => s.requestId);
	const lastCwd = usePromptComposition((s) => s.lastCwd);
	const options = useMemo(() => projectOptions(workspaces, requestedCwd), [workspaces, requestedCwd]);

	const [cwd, setCwd] = useState<string | null>(null);
	const [comp, setComp] = useState<PromptComposition | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openCats, setOpenCats] = useState<ReadonlySet<string>>(new Set());
	const [openItems, setOpenItems] = useState<ReadonlySet<string>>(new Set());
	const [targetWs, setTargetWs] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const probeSeq = useRef(0);
	const appliedRequest = useRef(-1);

	// Initial / re-requested project selection.
	useEffect(() => {
		if (options.length === 0) return;
		if (appliedRequest.current !== requestId) {
			appliedRequest.current = requestId;
			setCwd(pickInitialCwd(options, requestedCwd, lastCwd));
		} else if (cwd === null) {
			setCwd(pickInitialCwd(options, null, lastCwd));
		}
	}, [options, requestId, requestedCwd, lastCwd, cwd]);

	// Default AI target: Universal.
	useEffect(() => {
		if (targetWs === null) setTargetWs(options.find((o) => o.universal)?.path ?? options[0]?.path ?? null);
	}, [options, targetWs]);

	const load = useCallback((dir: string) => {
		const seq = ++probeSeq.current;
		setLoading(true);
		setError(null);
		setComp(null);
		promptCompositionProbe(dir)
			.then((c) => {
				if (probeSeq.current !== seq) return;
				setComp(c);
				usePromptComposition.getState().setLastCwd(dir);
			})
			.catch((err) => {
				if (probeSeq.current === seq) setError(errMsg(err));
			})
			.finally(() => {
				if (probeSeq.current === seq) setLoading(false);
			});
	}, []);

	useEffect(() => {
		if (cwd) load(cwd);
		return () => {
			probeSeq.current++;
		};
	}, [cwd, load]);

	const toggle = (set: ReadonlySet<string>, setter: (s: Set<string>) => void, id: string) => {
		const next = new Set(set);
		if (!next.delete(id)) next.add(id);
		setter(next);
	};

	const locate = (ids: string[]) => {
		if (!comp) return;
		const cats = new Set(openCats);
		for (const c of comp.categories) if (c.items.some((i) => ids.includes(i.id))) cats.add(c.id);
		setOpenCats(cats);
		setOpenItems(new Set([...openItems, ...ids.slice(0, 1)]));
		requestAnimationFrame(() => {
			document
				.querySelector(`[data-prompt-item="${CSS.escape(ids[0] ?? "")}"]`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	};

	const optimize = async () => {
		if (!comp) return;
		const target = options.find((o) => o.path === targetWs);
		if (!target) return;
		const projectOption = options.find((o) => o.path === comp.cwd);
		setCreating(true);
		try {
			const { sessionId, stub } = await createSession({
				cwd: target.path,
				workspaceId: target.workspaceId,
			});
			useSessions.getState().upsert([stub]);
			useComposer.getState().setDraft(sessionId, buildOptimizePrompt(comp, projectOption?.label ?? comp.cwd));
			useUi.getState().selectSession(sessionId);
			toast.success("已新建会话，分析内容已填入输入框，确认后再发送");
		} catch (err) {
			toast.error(`新建会话失败：${errMsg(err)}`);
		} finally {
			setCreating(false);
		}
	};

	const visible = comp ? nonEmptyCategories(comp) : [];
	const total = comp?.totalTokens ?? 0;

	return (
		<div className="space-y-5">
			<SectionHeader
				title="系统提示词构成"
				description="新建一个空会话时，模型在你说第一句话之前就已经带上的内容：系统提示词、规则文件、Skills、工具说明、MCP 工具。读取过程不调用模型，不产生费用，也不会留下会话。"
			/>

			<SettingsCard>
				<div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
					<span className="text-xs text-neutral-300">项目</span>
					<NativeSelect
						containerClassName="min-w-0 flex-1"
						value={cwd ?? ""}
						onChange={(e) => setCwd(e.target.value)}
						disabled={options.length === 0}
					>
						{options.map((o) => (
							<option key={o.path} value={o.path}>
								{o.label}
							</option>
						))}
					</NativeSelect>
					<Button icon={RefreshCw} loading={loading} onClick={() => cwd && load(cwd)} disabled={!cwd}>
						重新读取
					</Button>
				</div>
			</SettingsCard>

			{loading && (
				<div className="flex items-center gap-2 px-1 text-xs text-neutral-400">
					<Loader2 size={14} className="animate-spin" />
					正在读取，需要启动一次 omp，通常几秒
				</div>
			)}
			{error && (
				<Notice tone="danger" title="读取失败">
					<span className="whitespace-pre-wrap break-words select-text">{error}</span>
				</Notice>
			)}

			{comp && (
				<>
					<SettingsCard
						title="总览"
						footer={`${comp.estimateNote}。读取用时 ${(comp.probeMs / 1000).toFixed(1)} 秒。`}
					>
						<div className="space-y-3 px-3 py-3">
							<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-neutral-300">
								<span>
									估算合计 <b className="font-mono text-sm text-neutral-100">约 {fmtTokens(comp.totalTokens)} tokens</b>
								</span>
								{comp.reportedTokens != null && (
									<span className="text-neutral-400">OMP 自己报告：{fmtTokens(comp.reportedTokens)} tokens（参考）</span>
								)}
								{comp.contextWindow != null && comp.contextWindow > 0 && (
									<span className="text-neutral-400">
										占上下文窗口约 {sharePct(comp.totalTokens, comp.contextWindow).toFixed(1)}%
									</span>
								)}
							</div>
							<div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-selected)]">
								{visible.map((c) => (
									<div
										key={c.id}
										title={`${c.label} ${sharePct(c.tokens, total).toFixed(1)}%`}
										style={{ width: `${sharePct(c.tokens, total)}%`, backgroundColor: CATEGORY_COLOR[c.id] }}
									/>
								))}
							</div>
							<div className="flex flex-wrap gap-x-4 gap-y-1">
								{visible.map((c) => (
									<span key={c.id} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400">
										<span className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[c.id] }} />
										{c.label} {sharePct(c.tokens, total).toFixed(0)}%
									</span>
								))}
							</div>
						</div>
					</SettingsCard>

					<div className="space-y-2">
						<h3 className="px-1 text-[11px] font-semibold text-neutral-400">按类别查看（点开读原文）</h3>
						{visible.map((c) => (
							<CategoryCard
								key={c.id}
								category={c}
								total={total}
								open={openCats.has(c.id)}
								onToggle={() => toggle(openCats, setOpenCats, c.id)}
								openItems={openItems}
								onToggleItem={(id) => toggle(openItems, setOpenItems, id)}
							/>
						))}
					</div>

					<SettingsCard
						title="优化线索"
						footer="由固定规则自动算出，不调用 AI；只是线索，是否精简由你决定。"
						clip
					>
						{comp.hints.length === 0 ? (
							<div className="px-3 py-3 text-xs text-neutral-400">没有发现明显可以精简的地方。</div>
						) : (
							comp.hints.map((h) => <HintRow key={h.id} hint={h} onLocate={locate} />)
						)}
					</SettingsCard>

					<SettingsCard
						title="让 AI 帮我优化"
						footer="会新建一个会话，把上面的分析写进输入框，但不会自动发送。你看过、改过再发；AI 在改动任何文件前都必须先和你讨论并征得同意。"
					>
						<div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
							<span className="text-xs text-neutral-300">在哪个工作区新建会话</span>
							<NativeSelect
								containerClassName="min-w-0 flex-1"
								value={targetWs ?? ""}
								onChange={(e) => setTargetWs(e.target.value)}
							>
								{options.map((o) => (
									<option key={o.path} value={o.path}>
										{o.label}
									</option>
								))}
							</NativeSelect>
							<Button
								variant="primary"
								icon={Sparkles}
								loading={creating}
								onClick={() => void optimize()}
								disabled={!targetWs}
							>
								让 AI 帮我优化
							</Button>
						</div>
					</SettingsCard>
				</>
			)}

			<OmpSections page="prompt-composition" />
		</div>
	);
}
