import { Check, ChevronLeft, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../../core/api";
import { BottomSheet, Button, EmptyState, ListGroup, ListRow, Segmented, Spinner, toast } from "../../../ui";
import {
	currentModelOpt,
	filterModels,
	groupByProvider,
	isCurrentModel,
	modelLabel,
	resolveThinkingLevels,
	THINK_DESC,
	thinkLabel,
	type ModelFacts,
	type ModelOpt,
} from "../lib/models";
import { useModelFacts, type ModelSource } from "./useModelFacts";

/** Search results beyond this are not rendered; the user narrows the query instead. */
const SEARCH_CAP = 80;

/**
 * Model + thinking sheet (docs/MOBILE_DESIGN.md §4.6): thinking levels of the current model as a
 * segmented control on top; providers drill into their models; search flattens across providers.
 */
export function ModelThinkingSheet({
	open,
	onClose,
	source,
	currentLevel,
	onFacts,
}: {
	open: boolean;
	onClose: () => void;
	source: ModelSource;
	currentLevel?: string | null;
	onFacts: (f: ModelFacts & { model?: string }) => void;
}) {
	const { data, loading, error, reload, patch } = useModelFacts(open, source);
	const [q, setQ] = useState("");
	const [provider, setProvider] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const models = data?.models ?? [];
	const current = data?.current ?? null;
	const groups = useMemo(() => groupByProvider(models), [models]);
	const curOpt = data ? currentModelOpt(data.models, data.current) : null;

	useEffect(() => {
		if (open) setQ("");
	}, [open]);

	// Each load starts inside the current model's provider (the usual switch is a sibling model).
	useEffect(() => {
		if (!data) return;
		const cur = currentModelOpt(data.models, data.current);
		const only = groupByProvider(data.models);
		setProvider(cur?.provider ?? (only.length === 1 ? only[0].provider : null));
	}, [data]);

	const searching = q.trim() !== "";
	const results = useMemo(() => (searching ? filterModels(models, q) : []), [models, q, searching]);
	const activeModels = groups.find((g) => g.provider === provider)?.models ?? null;

	const level = data?.thinkingLevel ?? currentLevel ?? null;
	const levels = data ? resolveThinkingLevels(curOpt, data.liveThinking, level) : [];
	const curLevel = level || "auto";

	const pickModel = async (m: ModelOpt) => {
		if (busy) return;
		setBusy(true);
		try {
			const r = await source.setModel(m);
			onFacts({ ...r, model: `${m.provider}/${m.id}` });
			onClose();
		} catch (e) {
			toast(`切换模型失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	const pickThinking = async (l: string) => {
		if (busy) return;
		setBusy(true);
		try {
			const r = await source.setThinking(l);
			patch({ ...r, current: r.current ?? current });
			onFacts(r);
		} catch (e) {
			toast(`切换思考强度失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	const modelRow = (m: ModelOpt, withProvider: boolean) => {
		const on = isCurrentModel(m, current);
		return (
			<ListRow
				key={`${m.provider}/${m.id}`}
				title={modelLabel(m)}
				subtitle={<span className="font-m-mono break-all">{withProvider ? `${m.provider}/${m.id}` : m.id}</span>}
				right={on ? <Check size={20} className="text-m-accent" aria-label="当前模型" /> : undefined}
				chevron={false}
				onClick={() => void pickModel(m)}
				disabled={busy}
			/>
		);
	};

	let body;
	if (loading && !data) {
		body = (
			<div className="flex items-center justify-center gap-2 py-16 text-m-sm text-m-text-3">
				<Spinner /> 正在加载模型
			</div>
		);
	} else if (error && !data) {
		body = (
			<EmptyState
				title="模型列表加载失败"
				hint={<span className="m-selectable break-words">{error}</span>}
				action={
					<Button variant="tonal" onClick={reload}>
						重试
					</Button>
				}
			/>
		);
	} else if (!models.length) {
		body = <EmptyState title="没有可用模型" hint="请先在电脑端或设置中配置模型供应商" />;
	} else {
		body = (
			<div className="flex flex-col pb-8">
				<section className="px-4">
					<div className="px-1 pb-2 text-m-xs text-m-text-3">思考强度</div>
					{levels.length > 1 ? (
						<>
							<Segmented
								label="思考强度"
								value={curLevel}
								options={levels.map((l) => ({ value: l, label: thinkLabel(l) }))}
								onChange={(l) => void pickThinking(l)}
								disabled={busy}
								className="m-noscrollbar overflow-x-auto"
							/>
							{THINK_DESC[curLevel] && <div className="px-1 pt-2 text-m-xs text-m-text-3">{THINK_DESC[curLevel]}</div>}
						</>
					) : (
						<div className="px-1 text-m-sm text-m-text-2">当前模型不支持调整思考强度</div>
					)}
				</section>

				<label className="mx-4 mt-6 flex min-h-12 items-center gap-3 rounded-m-pill bg-m-surface px-4">
					<Search size={18} className="shrink-0 text-m-text-3" aria-hidden />
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="搜索模型或供应商"
						aria-label="搜索模型"
						className="min-h-11 min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none placeholder:text-m-text-3"
					/>
				</label>

				{searching ? (
					results.length === 0 ? (
						<div className="py-10 text-center text-m-sm text-m-text-3">没有匹配的模型</div>
					) : (
						<ListGroup
							title={`${results.length} 个结果`}
							note={results.length > SEARCH_CAP ? `只列出前 ${SEARCH_CAP} 个，输入更多关键词缩小范围` : undefined}
						>
							{results.slice(0, SEARCH_CAP).map((m) => modelRow(m, true))}
						</ListGroup>
					)
				) : activeModels ? (
					<section>
						{groups.length > 1 && (
							<div className="px-3 pt-3">
								<button
									type="button"
									onClick={() => setProvider(null)}
									className="flex min-h-11 items-center gap-1 rounded-m-pill pr-3 text-m-md text-m-accent active:bg-m-surface-hover"
								>
									<ChevronLeft size={22} />
									全部供应商
								</button>
							</div>
						)}
						<ListGroup title={`${provider} · ${activeModels.length} 个模型`} className={groups.length > 1 ? "[&>h3]:pt-1" : ""}>
							{activeModels.map((m) => modelRow(m, false))}
						</ListGroup>
					</section>
				) : (
					<ListGroup title="供应商">
						{groups.map((g) => {
							const mine = curOpt?.provider === g.provider;
							return (
								<ListRow
									key={g.provider}
									title={g.provider}
									subtitle={mine && curOpt ? `正在使用 ${modelLabel(curOpt)}` : undefined}
									right={<span>{g.models.length}</span>}
									chevron
									onClick={() => setProvider(g.provider)}
								/>
							);
						})}
					</ListGroup>
				)}
			</div>
		);
	}

	return (
		<BottomSheet open={open} onClose={onClose} title="模型" subtitle={curOpt ? modelLabel(curOpt) : current ? `${current.provider ? `${current.provider}/` : ""}${current.id}` : undefined} fullHeight>
			{body}
		</BottomSheet>
	);
}
