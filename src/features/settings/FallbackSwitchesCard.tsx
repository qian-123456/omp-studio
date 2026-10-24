/**
 * [D] Fallback switches card for Settings ▸ 备用模型与重试: the six scalar
 * `retry.*` keys that decide whether, when and how omp falls back to another
 * model. Every control saves instantly via `ompConfigSet`; the keys are hidden
 * from the flat OmpSections list (single edit entry).
 */
import { useT } from "../../stores/language";
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
	const { t } = useT();
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
			toast.error(t("settingsModels.saveFailed", { error: errMsg(e) }));
		} finally {
			setBusy(false);
		}
	};

	const commitPct = () => {
		if (pctError || Number(pctText) === pct) return;
		void save("retry.usageReservePct", String(Number(pctText)));
	};

	const offReason = t("settingsModels.masterFallbackDisabledNote");
	const noteOf = <T extends string>(opts: { value: T; note: string }[], v: T) => opts.find((o) => o.value === v)?.note;

	return { master, fallbackOn, revert, usageAware, reservePolicy, pct, busy, savedKey, pctText, setPctText, pctError, save, commitPct, offReason, noteOf };
}

/** Switches: master switch, trigger and revert policy. */
export function FallbackSwitchesCard({ onSaved }: { onSaved?: () => void }) {
	const { t } = useT();
	const { master, fallbackOn, revert, busy, savedKey, save, offReason, noteOf } = useFallbackSwitches(onSaved);

	return (
		<SettingsCard title={t("settingsModels.autoFallbackCardTitle")} jump={t("settingsModels.autoFallbackCardJump")}>
			<SettingRow
				label={<span title="retry.modelFallback">{t("settingsModels.autoFallbackLabel")}</span>}
				description={master ? t("settingsModels.autoFallbackDesc") : offReason}
				status={savedStatus(savedKey, "retry.modelFallback")}
				control={
					<Switch
						checked={master}
						disabled={busy}
						ariaLabel={t("settingsModels.autoFallbackAria")}
						onChange={(v) => void save("retry.modelFallback", v ? "true" : "false")}
					/>
				}
			/>
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.fallbackOn">{t("settingsModels.fallbackOnLabel")}</span>}
					description={master ? noteOf(FALLBACK_ON_OPTIONS, fallbackOn) : offReason}
					hint={t("settingsModels.fallbackOnHint")}
					status={savedStatus(savedKey, "retry.fallbackOn")}
					stacked
					control={
						<Segmented
							size="sm"
							value={fallbackOn}
							disabled={busy || !master}
							aria-label={t("settingsModels.fallbackOnAria")}
							onChange={(v) => void save("retry.fallbackOn", v)}
							options={FALLBACK_ON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
					}
				/>
			</div>
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.fallbackRevertPolicy">{t("settingsModels.revertPolicyLabel")}</span>}
					description={master ? noteOf(REVERT_POLICY_OPTIONS, revert) : offReason}
					hint={t("settingsModels.revertPolicyHint")}
					status={savedStatus(savedKey, "retry.fallbackRevertPolicy")}
					stacked
					control={
						<Segmented
							size="sm"
							value={revert}
							disabled={busy || !master}
							aria-label={t("settingsModels.revertPolicyAria")}
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
	const { t } = useT();
	const active = master && usageAware;

	return (
		<SettingsCard title={t("settingsModels.usageAwareCardTitle")} description={t("settingsModels.usageAwareCardDesc")} jump={t("settingsModels.usageAwareCardJump")}>
			<div className={master ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.usageAwareFallback">{t("settingsModels.usageAwareLabel")}</span>}
					description={
						master
							? t("settingsModels.usageAwareDesc")
							: offReason
					}
					hint={t("settingsModels.usageAwareHint")}
					status={savedStatus(savedKey, "retry.usageAwareFallback")}
					control={
						<Switch
							checked={usageAware}
							disabled={busy || !master}
							ariaLabel={t("settingsModels.usageAwareAria")}
							onChange={(v) => void save("retry.usageAwareFallback", v ? "true" : "false")}
						/>
					}
				/>
			</div>
			<div className={active ? undefined : "opacity-50"}>
				<SettingRow
					label={<span title="retry.usageReservePct">{t("settingsModels.reservePctLabel")}</span>}
					description={
						pctError ? (
							<span className="text-[var(--status-error)]">{pctError}</span>
						) : master && !usageAware ? (
							t("settingsModels.reservePctInactiveDesc")
						) : (
							t("settingsModels.reservePctActiveDesc")
						)
					}
					hint={t("settingsModels.reservePctHint", { pct: RESERVE_PCT_DEFAULT })}
					status={savedStatus(savedKey, "retry.usageReservePct")}
					control={
						<div className="flex items-center gap-1.5">
							<input
								type="text"
								inputMode="decimal"
								value={pctText}
								disabled={busy || !master || !usageAware}
								aria-label={t("settingsModels.reservePctAria")}
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
					label={<span title="retry.usageReservePolicy">{t("settingsModels.reservePolicyLabel")}</span>}
					description={noteOf(RESERVE_POLICY_OPTIONS, reservePolicy)}
					hint={t("settingsModels.reservePolicyHint")}
					status={savedStatus(savedKey, "retry.usageReservePolicy")}
					stacked
					control={
						<Segmented
							size="sm"
							value={reservePolicy}
							disabled={busy || !master || !usageAware}
							aria-label={t("settingsModels.reservePolicyAria")}
							onChange={(v) => void save("retry.usageReservePolicy", v)}
							options={RESERVE_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
						/>
					}
				/>
			</div>
		</SettingsCard>
	);
}
