/**
 * [D] Fallback switches card for Settings ▸ 备用模型与重试: the six scalar
 * `retry.*` keys that decide whether, when and how omp falls back to another
 * model. Every control saves instantly via `ompConfigSet`; the keys are hidden
 * from the flat OmpSections list (single edit entry).
 */
import { useEffect, useState } from "react";
import { Segmented } from "../../components/Segmented";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { ompConfigSet } from "../../lib/ipc";
import { toast } from "../../lib/toast";
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
import { SettingRow, SettingsCard, type SaveState } from "./ui";

const INPUT_CLASS =
	"h-8 w-20 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 text-xs tabular-nums text-[var(--text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] disabled:opacity-50";

const savedStatus = (savedKey: string | null, key: string): SaveState => (savedKey === key ? "saved" : "idle");

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
			toast.error(`保存失败：${errMsg(e)}`);
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
		<SettingsCard title="自动换备用模型">
			<SettingRow
				label={<span title="retry.modelFallback">失败时自动换用备用模型</span>}
				description={master ? "模型出错或额度用完时，按下方回退链依次尝试备用模型（默认开启）" : offReason}
				status={savedStatus(savedKey, "retry.modelFallback")}
				control={
					<Switch
						checked={master}
						disabled={busy}
						ariaLabel="自动换用备用模型"
						onChange={(v) => void save("retry.modelFallback", v ? "true" : "false")}
					/>
				}
			/>
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.fallbackOn">什么情况下回退</span>}
					description={master ? noteOf(FALLBACK_ON_OPTIONS, fallbackOn) : offReason}
					hint="默认：任何错误"
					status={savedStatus(savedKey, "retry.fallbackOn")}
					stacked
					control={
						<Segmented
							size="sm"
							value={fallbackOn}
							disabled={busy || !master}
							aria-label="回退触发条件"
							onChange={(v) => void save("retry.fallbackOn", v)}
							options={FALLBACK_ON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
					}
				/>
			</div>
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.fallbackRevertPolicy">回退之后何时切回主模型</span>}
					description={master ? noteOf(REVERT_POLICY_OPTIONS, revert) : offReason}
					hint="默认：自动切回"
					status={savedStatus(savedKey, "retry.fallbackRevertPolicy")}
					stacked
					control={
						<Segmented
							size="sm"
							value={revert}
							disabled={busy || !master}
							aria-label="回退后切回策略"
							onChange={(v) => void save("retry.fallbackRevertPolicy", v)}
							options={REVERT_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
					}
				/>
			</div>
		</SettingsCard>
	);
}

/** Low-frequency usage-aware early fallback: toggle, reserve percentage and reserve policy. */
export function UsageAwareCard({ onSaved }: { onSaved?: () => void }) {
	const { master, usageAware, reservePolicy, pct, busy, savedKey, pctText, setPctText, pctError, save, commitPct, offReason, noteOf } =
		useFallbackSwitches(onSaved);
	const active = master && usageAware;

	return (
		<SettingsCard title="额度预警" description="订阅套餐额度快用完时提前换模型，用得少">
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.usageAwareFallback">额度快用完时提前回退</span>}
					description={
						master
							? "根据订阅套餐的剩余额度，在彻底用完之前先换同供应商账户，再换备用模型；普通 API 密钥不参与"
							: offReason
					}
					hint="默认：关闭"
					status={savedStatus(savedKey, "retry.usageAwareFallback")}
					control={
						<Switch
							checked={usageAware}
							disabled={busy || !master}
							ariaLabel="额度快用完时提前回退"
							onChange={(v) => void save("retry.usageAwareFallback", v ? "true" : "false")}
						/>
					}
				/>
			</div>
			<div className={active ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.usageReservePct">剩余额度低于多少算快用完</span>}
					description={
						pctError ? (
							<span className="text-[var(--status-error)]">{pctError}</span>
						) : master && !usageAware ? (
							"打开上方「额度快用完时提前回退」后才会生效"
						) : (
							"取 0 到 100；未知或无法对应的用量一律继续使用主模型"
						)
					}
					hint={`默认：${RESERVE_PCT_DEFAULT}%`}
					status={savedStatus(savedKey, "retry.usageReservePct")}
					control={
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
							<span className="text-xs text-[var(--text-dim)]">%</span>
						</div>
					}
				/>
			</div>
			<div className={active ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.usageReservePolicy">所有同供应商账户都快用完时</span>}
					description={noteOf(RESERVE_POLICY_OPTIONS, reservePolicy)}
					hint="默认：先问我"
					status={savedStatus(savedKey, "retry.usageReservePolicy")}
					stacked
					control={
						<Segmented
							size="sm"
							value={reservePolicy}
							disabled={busy || !master || !usageAware}
							aria-label="额度预留策略"
							onChange={(v) => void save("retry.usageReservePolicy", v)}
							options={RESERVE_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
					}
				/>
			</div>
		</SettingsCard>
	);
}
