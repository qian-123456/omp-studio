import { Check } from "lucide-react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Spinner, toast } from "../../../ui";
import { currentModelOpt, resolveThinkingLevels, THINK_DESC, type ModelFacts } from "../lib/models";
import { useModelFacts } from "./useModelFacts";

export function ThinkingSheet({
	open,
	onClose,
	sessionId,
	currentLevel,
	onFacts,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	currentLevel: string | null;
	onFacts: (f: ModelFacts) => void;
}) {
	const { data, loading, error, reload } = useModelFacts(open, sessionId);
	const level = data?.thinkingLevel ?? currentLevel;
	const levels = data
		? resolveThinkingLevels(currentModelOpt(data.models, data.current), data.liveThinking, level)
		: [];
	const cur = level || "auto";

	const pick = async (l: string) => {
		try {
			const r = await api<ModelFacts>("POST", `/sessions/${sessionId}/thinking`, { level: l });
			onFacts({ current: r.current ?? null, thinkingLevel: r.thinkingLevel ?? null, liveThinking: r.liveThinking ?? [] });
			toast(`思考等级：${l}`, { kind: "success" });
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
	} else if (!levels.length) {
		body = <div className="p-8 text-center text-m-sm text-m-text-2">当前模型不支持调整思考等级</div>;
	} else {
		body = (
			<div>
				{levels.map((l) => (
					<button
						key={l}
						type="button"
						onClick={() => void pick(l)}
						className={`flex min-h-11 w-full items-center gap-2 border-b border-m-border px-4 py-2 text-left active:bg-m-surface ${l === cur ? "bg-m-surface" : ""}`}
					>
						<span className="min-w-0 flex-1">
							<span className="block text-m-md text-m-text">{l}</span>
							{THINK_DESC[l] && <span className="block text-m-xs text-m-text-2">{THINK_DESC[l]}</span>}
						</span>
						{l === cur && <Check size={18} className="shrink-0 text-m-accent" aria-label="当前等级" />}
					</button>
				))}
			</div>
		);
	}

	return (
		<BottomSheet open={open} onClose={onClose} title="思考等级">
			{body}
		</BottomSheet>
	);
}
