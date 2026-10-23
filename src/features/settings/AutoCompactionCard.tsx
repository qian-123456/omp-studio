import clsx from "clsx";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "../../components/Segmented";
import { ompConfigSet } from "../../lib/ipc";
import {
	PERCENT_MAX,
	PERCENT_MIN,
	PERCENT_PRESETS,
	TOKEN_PRESETS,
	type ThresholdMode,
	describeStrategy,
	formatTokenShort,
	formatTokens,
	parsePercentInput,
	parseTokenInput,
	readThreshold,
	resolveMode,
	thresholdWrites,
} from "./autoCompactionLogic";
import { useOmpConfigStore } from "./ompConfigStore";
import { Switch } from "./Switch";
import { Button, CommitInput, SaveIndicator, useSaveStatus } from "./ui";


/** Auto-compaction master switch + threshold (absolute tokens or window percent). */
export function AutoCompactionCard() {
	const entries = useOmpConfigStore((s) => s.entries);
	const valueOf = (key: string) => entries.find((e) => e.key === key)?.value;
	const enabled = valueOf("compaction.enabled") !== false;
	const threshold = readThreshold(valueOf("compaction.thresholdTokens"), valueOf("compaction.thresholdPercent"));
	const storedMode = resolveMode(threshold);
	// "default" has no editor; show the token editor until the user picks one.
	const [mode, setMode] = useState<Exclude<ThresholdMode, "default">>(storedMode === "percent" ? "percent" : "tokens");
	useEffect(() => {
		if (storedMode !== "default") setMode(storedMode);
	}, [storedMode]);
	const [sliderDraft, setSliderDraft] = useState<number | null>(null);
	const save = useSaveStatus();

	const write = async (pairs: [string, string][]) => {
		await save.run(async () => {
			for (const [k, v] of pairs) await ompConfigSet(k, v);
		});
		await useOmpConfigStore.getState().load(true);
	};
	const commit = (m: ThresholdMode, value?: number) => write(thresholdWrites(m, value));

	const percentShown = sliderDraft ?? (threshold.percent > 0 ? threshold.percent : 80);
	const fill = ((percentShown - PERCENT_MIN) / (PERCENT_MAX - PERCENT_MIN)) * 100;
	const shownThreshold = sliderDraft !== null ? { ...threshold, tokens: 0, percent: sliderDraft } : threshold;
	const commitDraft = () => {
		if (sliderDraft !== null) void commit("percent", sliderDraft).finally(() => setSliderDraft(null));
	};

	return (
		<div data-omp-key="compaction.enabled" className="space-y-3 px-4 py-3">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="text-xs font-medium text-[var(--text)]">自动上下文压缩</div>
					<div className="mt-0.5 text-[11px] leading-4 text-[var(--text-dim)]">
						上下文接近上限时，自动在后台把较早的对话总结成摘要，腾出窗口空间。
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<SaveIndicator status={save.status} error={save.error} />
					<Switch
						checked={enabled}
						ariaLabel="自动上下文压缩"
						onChange={(v) => void write([["compaction.enabled", String(v)]])}
					/>
				</div>
			</div>

			<div className={clsx("space-y-3", !enabled && "pointer-events-none opacity-50")}>
				<div className="flex items-center justify-between gap-3">
					<Segmented<"tokens" | "percent">
						size="sm"
						aria-label="压缩阈值模式"
						value={mode}
						onChange={setMode}
						disabled={!enabled}
						options={[
							{ value: "tokens", label: "按绝对 Token 数量" },
							{ value: "percent", label: "按窗口容量百分比" },
						]}
					/>
					<Button
						size="sm"
						icon={RotateCcw}
						disabled={!enabled || storedMode === "default"}
						onClick={() => void commit("default")}
					>
						恢复默认
					</Button>
				</div>

				{mode === "tokens" ? (
					<div className="space-y-2">
						<CommitInput
							className="w-48"
							mono
							aria-label="压缩阈值（Token）"
							placeholder="如 200k、30万、1.5M"
							value={threshold.tokens > 0 ? formatTokens(threshold.tokens) : ""}
							normalize={(raw) => {
								const n = parseTokenInput(raw);
								return n === null ? raw.trim() : formatTokens(n);
							}}
							validate={(v) => (v === "" || parseTokenInput(v) !== null ? null : "无法识别，请输入如 200k、30万、1.5M")}
							onCommit={(v) => {
								const n = parseTokenInput(v);
								return n === null ? commit("default") : commit("tokens", n);
							}}
						/>
						<div className="flex flex-wrap gap-1.5">
							{TOKEN_PRESETS.map((n) => (
								<Button
									key={n}
									size="sm"
									variant={storedMode === "tokens" && threshold.tokens === n ? "primary" : "secondary"}
									onClick={() => void commit("tokens", n)}
								>
									{formatTokenShort(n)}
								</Button>
							))}
						</div>
					</div>
				) : (
					<div className="space-y-2">
						<div className="flex items-center gap-3">
							<input
								type="range"
								aria-label="压缩阈值（百分比）"
								min={PERCENT_MIN}
								max={PERCENT_MAX}
								value={percentShown}
								onChange={(e) => setSliderDraft(Number(e.target.value))}
								onPointerUp={commitDraft}
								onKeyUp={commitDraft}
								onBlur={commitDraft}
								style={{
									background: `linear-gradient(to right, var(--accent) ${fill}%, rgba(255,255,255,0.12) ${fill}%)`,
								}}
								className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--accent)]"
							/>
							<CommitInput
								className="w-20"
								mono
								aria-label="压缩阈值百分比"
								value={sliderDraft !== null ? `${sliderDraft}%` : storedMode === "percent" ? `${threshold.percent}%` : ""}
								placeholder={`${PERCENT_MIN}%–${PERCENT_MAX}%`}
								normalize={(raw) => {
									const n = parsePercentInput(raw);
									return n === null ? raw.trim() : `${n}%`;
								}}
								validate={(v) => (v === "" || parsePercentInput(v) !== null ? null : "请输入 10%–95%")}
								onCommit={(v) => {
									const n = parsePercentInput(v);
									return n === null ? commit("default") : commit("percent", n);
								}}
							/>
						</div>
						<div className="flex flex-wrap gap-1.5">
							{PERCENT_PRESETS.map((p) => (
								<Button
									key={p}
									size="sm"
									variant={storedMode === "percent" && threshold.percent === p ? "primary" : "secondary"}
									onClick={() => void commit("percent", p)}
								>
									{p}%
								</Button>
							))}
						</div>
					</div>
				)}
			</div>

			<div className="rounded-lg bg-[var(--well-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--text-muted)]">
				{describeStrategy(shownThreshold, enabled)}
			</div>
		</div>
	);
}
