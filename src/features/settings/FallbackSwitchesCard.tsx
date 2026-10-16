/**
 * [D] Fallback switches card for Settings ▸ 回退链与切换: the six scalar
 * `retry.*` keys that decide whether, when and how omp falls back to another
 * model. Every control saves instantly via `ompConfigSet`; the keys are hidden
 * from the flat 重试与回退 page (single edit entry).
 */
import { Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../../components/Segmented";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import {
	FALLBACK_ON_DEFAULT,
	FALLBACK_ON_OPTIONS,
	FALLBACK_ON_VALUES,
	RESERVE_PCT_DEFAULT,
	RESERVE_POLICY_DEFAULT,
	RESERVE_POLICY_OPTIONS,
	RESERVE_POLICY_VALUES,
	REVERT_POLICY_DEFAULT,
	REVERT_POLICY_OPTIONS,
	REVERT_POLICY_VALUES,
	pickEnum,
	validateReservePct,
} from "./fallbackSwitches";
import { useOmpConfigStore } from "./ompConfigStore";
import { Switch } from "./Switch";

const INPUT_CLASS =
	"h-8 w-20 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 text-xs tabular-nums text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] disabled:opacity-50";

/** One labelled setting row; `dim` greys out the whole row. */
function Row({
	title,
	hint,
	saved,
	dim,
	children,
}: {
	title: string;
	hint?: string;
	saved: boolean;
	dim?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={dim ? "opacity-50" : undefined}>
			<div className="mb-1.5 flex items-center gap-2">
				<span className="text-[11px] font-semibold text-neutral-300">{title}</span>
				{hint && <span className="text-[10px] text-neutral-500">{hint}</span>}
				{saved && <Check className="h-2.5 w-2.5 text-emerald-400" />}
			</div>
			{children}
		</div>
	);
}

/** Shared state and save action for the six fallback switches. */
function useFallbackSwitches(onSaved?: () => void) {
	const entries = useOmpConfigStore((s) => s.entries);
	const get = (key: string) => entries.find((e) => e.key === key)?.value;

	const master = get("retry.modelFallback") !== false;
	const fallbackOn = pickEnum(get("retry.fallbackOn"), FALLBACK_ON_VALUES, FALLBACK_ON_DEFAULT);
	const revert = pickEnum(get("retry.fallbackRevertPolicy"), REVERT_POLICY_VALUES, REVERT_POLICY_DEFAULT);
	const usageAware = get("retry.usageAwareFallback") === true;
	const reservePolicy = pickEnum(get("retry.usageReservePolicy"), RESERVE_POLICY_VALUES, RESERVE_POLICY_DEFAULT);
	const rawPct = get("retry.usageReservePct");
	const pct = typeof rawPct === "number" && Number.isFinite(rawPct) ? rawPct : RESERVE_PCT_DEFAULT;

	const [busy, setBusy] = useState(false);
	const [savedKey, setSavedKey] = useState<string | null>(null);
	const [pctText, setPctText] = useState(String(pct));
	const pctError = validateReservePct(pctText);

	useEffect(() => {
		setPctText(String(pct));
	}, [pct]);

	const save = async (key: string, value: string) => {
		if (busy) return;
		setBusy(true);
		try {
			await ompConfigSet(key, value);
			setSavedKey(key);
			setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
			await useOmpConfigStore.getState().load(true);
			onSaved?.();
		} catch (e) {
			toast.error(`保存 ${key} 失败：${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const commitPct = () => {
		if (pctError || Number(pctText) === pct) return;
		void save("retry.usageReservePct", String(Number(pctText)));
	};

	const offReason = "已关闭「模型回退」，下面的设置暂不生效";
	const noteOf = <T extends string>(opts: { value: T; note: string }[], v: T) => opts.find((o) => o.value === v)?.note;

	return { master, fallbackOn, revert, usageAware, reservePolicy, pct, busy, savedKey, pctText, setPctText, pctError, save, commitPct, offReason, noteOf };
}

/** Switches: master switch, trigger and revert policy. */
export function FallbackSwitchesCard({ onSaved }: { onSaved?: () => void }) {
	const { master, fallbackOn, revert, busy, savedKey, save, offReason, noteOf } = useFallbackSwitches(onSaved);

	return (
		<div className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[11px] font-semibold text-neutral-300">失败时自动换用备用模型</span>
						<span className="text-[10px] text-neutral-500">(retry.modelFallback)</span>
						{savedKey === "retry.modelFallback" && <Check className="h-2.5 w-2.5 text-emerald-400" />}
					</div>
					<p className="mt-1 text-[11px] leading-[1.4] text-neutral-500">
						{master ? "模型出错或额度用完时，按下方回退链依次尝试备用模型（默认开启）" : offReason}
					</p>
				</div>
				<Switch
					checked={master}
					disabled={busy}
					ariaLabel="自动换用备用模型"
					onChange={(v) => void save("retry.modelFallback", v ? "true" : "false")}
				/>
			</div>

			<Row title="什么情况下回退" hint="(retry.fallbackOn · 默认：任何错误)" saved={savedKey === "retry.fallbackOn"} dim={!master}>
				<Segmented
					size="sm"
					value={fallbackOn}
					disabled={busy || !master}
					aria-label="回退触发条件"
					onChange={(v) => void save("retry.fallbackOn", v)}
					options={FALLBACK_ON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
				/>
				<p className="mt-1.5 text-[11px] leading-[1.4] text-neutral-500">
					{master ? noteOf(FALLBACK_ON_OPTIONS, fallbackOn) : offReason}
				</p>
			</Row>

			<Row
				title="回退之后何时切回主模型"
				hint="(retry.fallbackRevertPolicy · 默认：自动切回)"
				saved={savedKey === "retry.fallbackRevertPolicy"}
				dim={!master}
			>
				<Segmented
					size="sm"
					value={revert}
					disabled={busy || !master}
					aria-label="回退后切回策略"
					onChange={(v) => void save("retry.fallbackRevertPolicy", v)}
					options={REVERT_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
				/>
				<p className="mt-1.5 text-[11px] leading-[1.4] text-neutral-500">
					{master ? noteOf(REVERT_POLICY_OPTIONS, revert) : offReason}
				</p>
			</Row>

			<p className="text-[11px] leading-[1.4] text-neutral-500">
				重试次数、最长等待、等待用量重置在
				<button
					type="button"
					onClick={() => useUi.getState().openSettings("omp-retry")}
					className="mx-0.5 text-[var(--accent)] underline-offset-2 hover:underline"
				>
					重试与回退
				</button>
				页设置。
			</p>
		</div>
	);
}

/** Low-frequency usage-aware early fallback: toggle, reserve percentage and reserve policy. */
export function UsageAwareCard({ onSaved }: { onSaved?: () => void }) {
	const { master, usageAware, reservePolicy, pct, busy, savedKey, pctText, setPctText, pctError, save, commitPct, offReason, noteOf } =
		useFallbackSwitches(onSaved);

	return (
		<div>
			<h3 className="mb-1.5 px-1 text-[11px] font-semibold text-neutral-400">
				额度预警
				<span className="ml-1.5 font-normal text-neutral-500">订阅套餐额度快用完时提前换模型，用得少</span>
			</h3>
			<div className="space-y-3 rounded-xl hairline bg-[var(--bg-panel)] p-3.5 shadow-apple-card">
				<div className="flex items-start justify-between gap-3">
					<div className={`min-w-0 ${master ? "" : "opacity-50"}`}>
						<div className="flex items-center gap-2">
							<span className="text-[11px] font-semibold text-neutral-300">额度快用完时提前回退</span>
							<span className="text-[10px] text-neutral-500">(retry.usageAwareFallback · 默认：关闭)</span>
							{savedKey === "retry.usageAwareFallback" && <Check className="h-2.5 w-2.5 text-emerald-400" />}
						</div>
						<p className="mt-1 text-[11px] leading-[1.4] text-neutral-500">
							{master
								? "根据订阅套餐（coding-plan）的剩余额度，在彻底用完之前先换同供应商账户，再换备用模型；普通 API 密钥不参与"
								: offReason}
						</p>
					</div>
					<Switch
						checked={usageAware}
						disabled={busy || !master}
						ariaLabel="额度快用完时提前回退"
						onChange={(v) => void save("retry.usageAwareFallback", v ? "true" : "false")}
					/>
				</div>

				<div className={master && usageAware ? "space-y-3" : "space-y-3 opacity-50"}>
					<Row
						title="剩余额度低于多少算快用完"
						hint={`(retry.usageReservePct · 默认：${RESERVE_PCT_DEFAULT}%)`}
						saved={savedKey === "retry.usageReservePct"}
					>
						<div className="flex items-center gap-1.5">
							<input
								type="text"
								inputMode="decimal"
								value={pctText}
								disabled={busy || !master || !usageAware}
								aria-label="预留额度百分比"
								aria-invalid={pctError !== null}
								onChange={(e) => setPctText(e.target.value)}
								onBlur={commitPct}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !isComposing(e)) e.currentTarget.blur();
									if (e.key === "Escape") setPctText(String(pct));
								}}
								className={INPUT_CLASS}
							/>
							<span className="text-xs text-neutral-500">%</span>
						</div>
						<p className={`mt-1.5 text-[11px] leading-[1.4] ${pctError ? "text-rose-300" : "text-neutral-500"}`}>
							{pctError ?? "取 0 到 100；未知或无法对应的用量一律继续使用主模型"}
						</p>
					</Row>

					<Row
						title="所有同供应商账户都快用完时"
						hint="(retry.usageReservePolicy · 默认：先问我)"
						saved={savedKey === "retry.usageReservePolicy"}
					>
						<Segmented
							size="sm"
							value={reservePolicy}
							disabled={busy || !master || !usageAware}
							aria-label="额度预留策略"
							onChange={(v) => void save("retry.usageReservePolicy", v)}
							options={RESERVE_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
						<p className="mt-1.5 text-[11px] leading-[1.4] text-neutral-500">
							{noteOf(RESERVE_POLICY_OPTIONS, reservePolicy)}
						</p>
					</Row>
					{master && !usageAware && (
						<p className="text-[11px] leading-[1.4] text-neutral-500">打开上方「额度快用完时提前回退」后才会生效</p>
					)}
				</div>
			</div>
		</div>
	);
}
