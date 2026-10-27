import { useEffect, useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Spinner, toast } from "../../../ui";
import {
	currentModelOpt,
	filterModels,
	groupByProvider,
	isCurrentModel,
	modelLabel,
	resolveThinkingLevels,
	THINK_DESC,
	type ModelFacts,
	type ModelOpt,
} from "../lib/models";
import { useModelFacts } from "./useModelFacts";

type Tab = "model" | "thinking";

export function ModelThinkingSheet({
	open,
	onClose,
	sessionId,
	initialTab = "model",
	currentLevel,
	onFacts,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	initialTab?: Tab;
	currentLevel?: string | null;
	onFacts: (f: ModelFacts & { model?: string }) => void;
}) {
	const [tab, setTab] = useState<Tab>(initialTab);
	const { data, loading, error, reload } = useModelFacts(open, sessionId);
	const [q, setQ] = useState("");
	const [provider, setProvider] = useState<string | null>(null);

	const models = data?.models ?? [];
	const current = data?.current ?? null;
	const groups = useMemo(() => groupByProvider(models), [models]);

	useEffect(() => {
		if (open) {
			setTab(initialTab);
			setQ("");
		}
	}, [open, initialTab]);

	useEffect(() => {
		if (!data) return;
		const cur = currentModelOpt(data.models, data.current);
		if (cur) setProvider(cur.provider);
	}, [data]);

	const searching = q.trim() !== "";
	const results = useMemo(() => (searching ? filterModels(models, q) : []), [models, q, searching]);
	const resultGroups = useMemo(() => groupByProvider(results), [results]);
	const activeProvider = groups.some((g) => g.provider === provider) ? provider : (groups[0]?.provider ?? null);
	const activeModels = groups.find((g) => g.provider === activeProvider)?.models ?? [];

	const level = data?.thinkingLevel ?? currentLevel ?? null;
	const levels = data
		? resolveThinkingLevels(currentModelOpt(data.models, data.current), data.liveThinking, level)
		: [];
	const curLevel = level || "auto";

	const pickModel = async (m: ModelOpt) => {
		try {
			const r = await api<ModelFacts>("POST", `/sessions/${sessionId}/model`, { model: m.id });
			onFacts({ current: r.current ?? null, thinkingLevel: r.thinkingLevel ?? null, liveThinking: r.liveThinking ?? [], model: m.id });
			toast(`已切换模型：${modelLabel(m)}`, { kind: "success" });
			onClose();
		} catch (e) {
			toast(`切换模型失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	const pickThinking = async (l: string) => {
		try {
			const r = await api<ModelFacts>("POST", `/sessions/${sessionId}/thinking`, { level: l });
			onFacts({ current: r.current ?? null, thinkingLevel: r.thinkingLevel ?? null, liveThinking: r.liveThinking ?? [] });
			toast(`思考等级：${l}`, { kind: "success" });
			onClose();
		} catch (e) {
			toast(`切换思考等级失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	let content;
	if (loading && !data) {
		content = (
			<div className="flex items-center justify-center gap-2 p-8 text-m-sm text-m-text-2">
				<Spinner /> 加载中
			</div>
		);
	} else if (error && !data) {
		content = (
			<div className="flex flex-col items-center gap-3 p-6 text-center">
				<div className="break-words text-m-sm text-m-danger [overflow-wrap:anywhere]">加载失败：{error}</div>
				<button
					type="button"
					onClick={reload}
					className="min-h-11 whitespace-nowrap rounded-m-md bg-m-accent px-5 text-m-sm text-m-accent-text"
				>
					重试
				</button>
			</div>
		);
	} else if (tab === "thinking") {
		content = (
			<div className="pb-4">
				{!levels.length ? (
					<div className="p-8 text-center text-m-sm text-m-text-2">当前模型不支持调整思考等级</div>
				) : (
					levels.map((l) => (
						<button
							key={l}
							type="button"
							onClick={() => void pickThinking(l)}
							className={`flex min-h-12 w-full items-center gap-2 border-b border-m-border px-4 py-2 text-left active:bg-m-surface ${
								l === curLevel ? "bg-m-surface" : ""
							}`}
						>
							<span className="min-w-0 flex-1">
								<span className="block text-m-md text-m-text font-medium">{l}</span>
								{THINK_DESC[l] && <span className="block text-m-xs text-m-text-2">{THINK_DESC[l]}</span>}
							</span>
							{l === curLevel && <Check size={18} className="shrink-0 text-m-accent" aria-label="当前等级" />}
						</button>
					))
				)}
			</div>
		);
	} else {
		// Model selection tab
		content = (
			<div className="flex min-h-0 flex-1 flex-col">
				<div className="border-b border-m-border px-4 py-2">
					<div className="flex min-h-10 items-center gap-2 rounded-m-pill bg-m-surface px-3 text-m-sm text-m-text-2">
						<Search size={16} className="text-m-text-3" />
						<input
							type="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索模型…"
							className="min-w-0 flex-1 bg-transparent text-m-text outline-none placeholder:text-m-text-3"
						/>
					</div>
				</div>

				{searching ? (
					<div className="min-h-0 flex-1 overflow-y-auto">
						{!results.length ? (
							<div className="p-8 text-center text-m-sm text-m-text-2">未找到匹配模型</div>
						) : (
							resultGroups.map((g) => (
								<div key={g.provider}>
									<div className="sticky top-0 bg-m-bg-elev px-4 py-1 text-m-xs font-semibold text-m-text-3">
										{g.provider}
									</div>
									{g.models.map((m) => (
										<button
											key={m.id}
											type="button"
											onClick={() => void pickModel(m)}
											className={`flex min-h-12 w-full items-center gap-2 border-b border-m-border px-4 py-2 text-left active:bg-m-surface ${
												isCurrentModel(m, current) ? "bg-m-surface" : ""
											}`}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-m-md text-m-text">{modelLabel(m)}</span>
												<span className="block truncate font-m-mono text-m-xs text-m-text-3">{m.id}</span>
											</span>
											{isCurrentModel(m, current) && (
												<Check size={18} className="shrink-0 text-m-accent" aria-label="当前模型" />
											)}
										</button>
									))}
								</div>
							))
						)}
					</div>
				) : (
					<div className="flex min-h-0 flex-1">
						{groups.length > 1 && (
							<div className="w-28 shrink-0 overflow-y-auto border-r border-m-border bg-m-surface">
								{groups.map((g) => (
									<button
										key={g.provider}
										type="button"
										onClick={() => setProvider(g.provider)}
										className={`block min-h-11 w-full truncate border-b border-m-border px-3 text-left text-m-xs font-medium ${
											g.provider === activeProvider ? "bg-m-bg text-m-accent" : "text-m-text-2 active:bg-m-surface-hover"
										}`}
									>
										{g.provider}
									</button>
								))}
							</div>
						)}
						<div className="min-h-0 flex-1 overflow-y-auto">
							{activeModels.map((m) => (
								<button
									key={m.id}
									type="button"
									onClick={() => void pickModel(m)}
									className={`flex min-h-12 w-full items-center gap-2 border-b border-m-border px-4 py-2 text-left active:bg-m-surface ${
										isCurrentModel(m, current) ? "bg-m-surface" : ""
									}`}
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-m-md text-m-text">{modelLabel(m)}</span>
										<span className="block truncate font-m-mono text-m-xs text-m-text-3">{m.id}</span>
									</span>
									{isCurrentModel(m, current) && (
										<Check size={18} className="shrink-0 text-m-accent" aria-label="当前模型" />
									)}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<BottomSheet open={open} onClose={onClose} title="模型与思考" fullHeight>
			<div className="flex h-full flex-col">
				<div className="flex border-b border-m-border px-4 pt-1">
					<button
						type="button"
						onClick={() => setTab("model")}
						className={`flex-1 border-b-2 py-2 text-center text-m-sm font-medium ${
							tab === "model" ? "border-m-accent text-m-accent" : "border-transparent text-m-text-2"
						}`}
					>
						选择模型
					</button>
					<button
						type="button"
						onClick={() => setTab("thinking")}
						className={`flex-1 border-b-2 py-2 text-center text-m-sm font-medium ${
							tab === "thinking" ? "border-m-accent text-m-accent" : "border-transparent text-m-text-2"
						}`}
					>
						思考等级
					</button>
				</div>
				<div className="min-h-0 flex-1">{content}</div>
			</div>
		</BottomSheet>
	);
}
