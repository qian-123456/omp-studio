/**
 * [D] Step 4 of 批量替换模型: the outcome of every edit (ok / fail + reason) with
 * a retry of the failed ones, plus the live sessions that still run the source
 * model with a one-click 切换到 Y.
 */
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelReplaceEdit, ModelReplaceItemResult } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { ensureLive, isResumeCancelled } from "../../../lib/ensureLive";
import { rpcSend } from "../../../lib/ipc";
import { buildSetModelPayload } from "../../../lib/models";
import { toast } from "../../../lib/toast";
import { useLive } from "../../../stores/live";
import { useModelOptions } from "../../../stores/modelCatalog";
import { useSessions } from "../../../stores/sessions";
import { liveSessionsOnModel, summarizeEdit } from "./logic";
import { BTN_PRIMARY, CHECKBOX_CLASS, Chip } from "./parts";

/** Live sessions that still run the source model; switching is opt-in per session. */
function LiveSessionsCard({
	fromModel,
	toModel,
	level,
}: {
	fromModel: string;
	toModel: string;
	level: string | null;
}) {
	const live = useLive((s) => s.sessions);
	const metas = useSessions((s) => s.sessions);
	const models = useModelOptions();
	const [picked, setPicked] = useState<Record<string, boolean>>({});
	const [switching, setSwitching] = useState(false);

	const candidates = useMemo(
		() =>
			liveSessionsOnModel(
				Object.entries(live)
					.filter(([, session]) => session.alive)
					.map(([sessionId, session]) => ({
						sessionId,
						title: metas[sessionId]?.title ?? sessionId,
						cwd: metas[sessionId]?.cwd ?? null,
						modelState: session.state?.model ?? null,
					})),
				models,
				fromModel,
			),
		[live, metas, models, fromModel],
	);

	const selected = candidates.filter((c) => picked[c.sessionId]);
	const switchSelected = async () => {
		const payload = buildSetModelPayload(toModel, models);
		if (!payload) {
			toast.error("无法解析目标模型");
			return;
		}
		setSwitching(true);
		let switched = 0;
		const failures: string[] = [];
		for (const candidate of selected) {
			try {
				if (!live[candidate.sessionId]?.alive) await ensureLive(candidate.sessionId);
				await rpcSend(candidate.sessionId, payload);
				if (level) await rpcSend(candidate.sessionId, { type: "set_thinking_level", level });
				await rpcSend(candidate.sessionId, { type: "get_state" });
				switched += 1;
			} catch (e) {
				if (!isResumeCancelled(e)) failures.push(`${candidate.title}: ${errMsg(e)}`);
			}
		}
		setSwitching(false);
		if (switched > 0) toast.success(`已切换 ${switched} 个运行中的会话`);
		if (failures.length > 0) toast.error(`切换失败 ${failures.length} 个：${failures[0]}`);
	};

	if (candidates.length === 0) return null;
	return (
		<div className="mx-3 mb-3 rounded-xl hairline">
			<div className="flex items-center justify-between gap-2 rounded-t-xl bg-[var(--well-bg)] px-3 py-1.5 text-[10px] text-neutral-500">
				<span className="min-w-0 break-all">仍在「{fromModel}」上运行的会话（{candidates.length}）</span>
				<span className="text-neutral-500">写入配置不会改变运行中的会话</span>
			</div>
			{candidates.map((candidate) => (
				<label
					key={candidate.sessionId}
					className="flex cursor-pointer items-center gap-2 border-t border-[var(--border-divider)] px-3 py-1.5 text-[11px]"
				>
					<input
						type="checkbox"
						checked={picked[candidate.sessionId] ?? false}
						onChange={(e) => setPicked((prev) => ({ ...prev, [candidate.sessionId]: e.target.checked }))}
						className={CHECKBOX_CLASS}
					/>
					<span className="min-w-0 flex-1 break-all text-neutral-300" title={candidate.cwd ?? candidate.sessionId}>
						{candidate.title}
					</span>
					<span className="max-w-[45%] shrink-0 break-all font-mono text-[10px] text-neutral-500">{candidate.value}</span>
				</label>
			))}
			<div className="flex items-center gap-2 border-t border-[var(--border-divider)] px-3 py-2">
				<button
					type="button"
					onClick={() => void switchSelected()}
					disabled={switching || selected.length === 0}
					className={BTN_PRIMARY}
				>
					{switching ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
					切换到 {toModel}
				</button>
				<span className="text-[10px] text-neutral-500">
					{level ? `同时设置思考等级 ${level}` : "不改变这些会话的思考等级"}
				</span>
			</div>
		</div>
	);
}

export function ModelReplaceResults({
	results,
	fromModel,
	toModel,
	level,
	liveSwitch,
	projectNames,
	retrying,
	onRetry,
}: {
	results: ModelReplaceItemResult[];
	fromModel: string;
	toModel: string;
	level: string | null;
	/** Live sessions only switch to chat models; hidden for search / judge targets. */
	liveSwitch: boolean;
	projectNames: Record<string, string>;
	retrying: boolean;
	onRetry: (edits: ModelReplaceEdit[]) => void;
}) {
	const failed = results.filter((r) => !r.ok);
	const succeeded = results.length - failed.length;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[11px]">
				<span className="flex items-center gap-1 text-emerald-300">
					<CheckCircle2 className="h-3 w-3" />
					成功 {succeeded}
				</span>
				{failed.length > 0 && (
					<>
						<span className="flex items-center gap-1 text-rose-300">
							<XCircle className="h-3 w-3" />
							失败 {failed.length}
						</span>
						<button
							type="button"
							onClick={() => onRetry(failed.map((r) => r.edit))}
							disabled={retrying}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] text-neutral-200 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
						>
							<RefreshCw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
							重试失败项
						</button>
					</>
				)}
				<span className="flex min-w-0 flex-wrap items-center gap-1 break-all font-mono text-[10px] text-neutral-500">
					{fromModel}
					<ArrowRight className="h-3 w-3 shrink-0" />
					{toModel}
					{level ? `:${level}` : ""}
				</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-3">
				<div className="rounded-xl hairline">
					{results.map((result, index) => {
						const summary = summarizeEdit(result.edit, projectNames);
						return (
							<div
								key={`${summary.title}:${summary.context}:${index}`}
								className="flex items-start gap-2 border-t border-[var(--border-divider)] px-3 py-2 text-[11px] first:border-t-0"
							>
								{result.ok ? (
									<CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
								) : (
									<XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
								)}
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="font-medium text-neutral-200">{summary.title}</span>
										<Chip tone="neutral">{summary.context}</Chip>
									</div>
									<div className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[10px] text-neutral-500">
										{summary.before} → {summary.after}
									</div>
									{summary.details.map((line) => (
										<div key={line} className="whitespace-pre-wrap break-all font-mono text-[10px] text-neutral-500">
											{line}
										</div>
									))}
									{!result.ok && result.error !== null && (
										<div className="mt-0.5 whitespace-pre-wrap break-all text-rose-300">{result.error}</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{liveSwitch && <LiveSessionsCard fromModel={fromModel} toModel={toModel} level={level} />}
		</div>
	);
}
