import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Spinner, toast } from "../../../ui";
import {
	filterModels,
	groupByProvider,
	isCurrentModel,
	modelLabel,
	currentModelOpt,
	type ModelFacts,
	type ModelOpt,
} from "../lib/models";
import { useModelFacts } from "./useModelFacts";

function ModelRow({ m, on, showProvider, onPick }: { m: ModelOpt; on: boolean; showProvider?: boolean; onPick: () => void }) {
	const label = modelLabel(m);
	return (
		<button
			type="button"
			onClick={onPick}
			className={`flex min-h-11 w-full items-start gap-2 border-b border-m-border px-3 py-2 text-left active:bg-m-surface ${on ? "bg-m-surface" : ""}`}
		>
			<span className="min-w-0 flex-1">
				<span className="block break-words text-m-md text-m-text [overflow-wrap:anywhere]">{label}</span>
				{(label !== m.id || showProvider) && (
					<span className="block break-all font-m-mono text-m-xs text-m-text-2">
						{showProvider ? `${m.provider}/${m.id}` : m.id}
					</span>
				)}
			</span>
			{on && <Check size={18} className="mt-0.5 shrink-0 text-m-accent" aria-label="当前模型" />}
		</button>
	);
}

export function ModelSheet({
	open,
	onClose,
	sessionId,
	onFacts,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	onFacts: (f: ModelFacts & { model: string }) => void;
}) {
	const { data, loading, error, reload } = useModelFacts(open, sessionId);
	const [q, setQ] = useState("");
	const [provider, setProvider] = useState<string | null>(null);
	const models = data?.models ?? [];
	const current = data?.current ?? null;
	const groups = useMemo(() => groupByProvider(models), [models]);

	useEffect(() => {
		if (open) setQ("");
	}, [open]);
	// Preselect the current model's provider once the catalog arrives.
	useEffect(() => {
		if (!data) return;
		const cur = currentModelOpt(data.models, data.current);
		setProvider(cur?.provider ?? groupByProvider(data.models)[0]?.provider ?? null);
	}, [data]);

	const searching = q.trim() !== "";
	const results = useMemo(() => (searching ? filterModels(models, q) : []), [models, q, searching]);
	const resultGroups = useMemo(() => groupByProvider(results), [results]);
	const activeProvider = groups.some((g) => g.provider === provider) ? provider : (groups[0]?.provider ?? null);
	const activeModels = groups.find((g) => g.provider === activeProvider)?.models ?? [];

	const pick = async (m: ModelOpt) => {
		try {
			const r = await api<ModelFacts & { ok?: boolean }>("POST", `/sessions/${sessionId}/model`, {
				provider: m.provider,
				modelId: m.id,
			});
			const c = r.current;
			onFacts({
				current: c,
				thinkingLevel: r.thinkingLevel ?? null,
				liveThinking: r.liveThinking ?? [],
				model: c ? (c.provider ? `${c.provider}/` : "") + c.id : `${m.provider}/${m.id}`,
			});
			toast(`已切换模型：${m.id}`, { kind: "success" });
			onClose();
		} catch (e) {
			toast(`切换失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	let body;
	if (loading && !data) {
		body = (
			<div className="flex items-center justify-center gap-2 p-8 text-m-sm text-m-text-2">
				<Spinner /> 加载中
			</div>
		);
	} else if (error && !data) {
		body = (
			<div className="flex flex-col items-center gap-3 p-6 text-center">
				<div className="break-words text-m-sm text-m-danger [overflow-wrap:anywhere]">加载失败：{error}</div>
				<button type="button" onClick={reload} className="min-h-11 whitespace-nowrap rounded-m-md bg-m-accent px-5 text-m-sm text-m-accent-text">
					重试
				</button>
			</div>
		);
	} else if (!models.length) {
		body = <div className="p-8 text-center text-m-sm text-m-text-2">没有可用模型</div>;
	} else if (searching) {
		body = results.length ? (
			<div className="h-full overflow-y-auto overscroll-contain">
				{resultGroups.map((g) => (
					<div key={g.provider}>
						<div className="sticky top-0 bg-m-surface px-3 py-1 text-m-xs font-semibold text-m-text-2">{g.provider}</div>
						{g.models.map((m) => (
							<ModelRow key={`${m.provider}/${m.id}`} m={m} showProvider on={isCurrentModel(m, current)} onPick={() => void pick(m)} />
						))}
					</div>
				))}
			</div>
		) : (
			<div className="p-8 text-center text-m-sm text-m-text-2">没有匹配的模型</div>
		);
	} else {
		body = (
			<div className="flex h-full min-h-0">
				<div className="w-[34%] max-w-40 shrink-0 overflow-y-auto overscroll-contain border-r border-m-border bg-m-surface">
					{groups.map((g) => {
						const sel = g.provider === activeProvider;
						const hasCur = g.models.some((m) => isCurrentModel(m, current));
						return (
							<button
								key={g.provider}
								type="button"
								onClick={() => setProvider(g.provider)}
								className={`flex min-h-11 w-full items-center gap-1 px-3 py-2 text-left text-m-sm ${sel ? "bg-m-bg-elev font-semibold text-m-accent" : "text-m-text"}`}
							>
								<span className="min-w-0 flex-1 break-all">{g.provider}</span>
								{hasCur && <Check size={14} className="shrink-0 text-m-accent" />}
							</button>
						);
					})}
				</div>
				<div className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
					{activeModels.map((m) => (
						<ModelRow key={m.id} m={m} on={isCurrentModel(m, current)} onPick={() => void pick(m)} />
					))}
				</div>
			</div>
		);
	}

	return (
		<BottomSheet open={open} onClose={onClose} title="选择模型" fullHeight>
			<div className="flex h-full flex-col">
				<div className="shrink-0 border-b border-m-border px-3 pb-2">
					<label className="flex min-h-11 items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3">
						<Search size={16} className="shrink-0 text-m-text-2" />
						<input
							type="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索模型或提供商"
							className="min-w-0 flex-1 bg-transparent text-m-md text-m-text outline-none placeholder:text-m-text-3"
						/>
					</label>
				</div>
				<div className="min-h-0 flex-1">{body}</div>
			</div>
		</BottomSheet>
	);
}
