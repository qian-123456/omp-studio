import { type ReactNode, useState } from "react";
import { useT } from "../../stores/language";
import { MODELS_YML_PATH } from "./keyState";
import type { KeyInputMode as Mode, KeyInputProblem } from "./keyInput";

/** 密钥怎么提供: plain text in models.yml, or a reference to an environment variable. Shared by the add/edit form, 设置密钥 and service config. */
export function KeyInputMode({
	name,
	mode,
	onModeChange,
	envName,
	onEnvNameChange,
	problem,
	attempted,
	current,
	plainNote,
	onSubmit,
	children,
}: {
	/** Radio group name / id prefix; unique per dialog. */
	name: string;
	mode: Mode;
	onModeChange: (next: Mode) => void;
	envName: string;
	onEnvNameChange: (next: string) => void;
	problem: KeyInputProblem | null;
	/** Save was tried once: also show the "empty" problems. */
	attempted: boolean;
	/** Live state of the variable currently saved for this provider, shown when the typed name matches. */
	current?: { name: string; set: boolean | null } | null;
	/** Overrides the default plain-text note. */
	plainNote?: string;
	onSubmit?: () => void;
	/** The dialog's own plain-key input. */
	children: ReactNode;
}) {
	const { t } = useT();
	const [howOpen, setHowOpen] = useState(false);
	const options: { value: Mode; label: string; hint: string }[] = [
		{ value: "plain", label: t("providers.keyInputModePlain"), hint: t("providers.keyInputModePlainHint", { path: MODELS_YML_PATH }) },
		{ value: "env", label: t("providers.keyInputModeEnv"), hint: t("providers.keyInputModeEnvHint") },
	];
	const showProblem = problem !== null && (attempted || (problem !== "envEmpty" && problem !== "plainRequired"));
	const problemKey: Record<KeyInputProblem, string> = {
		envEmpty: "providers.envNameEmpty",
		envInvalid: "providers.envNameInvalid",
		plainLooksLikeName: "providers.plainLooksLikeName",
		plainRequired: "providers.errorEmptyKey",
	};
	const shownName = envName.trim();
	const status = current && current.name === shownName ? current.set : undefined;

	return (
		<div className="space-y-3">
			<fieldset>
				<legend className="text-xs font-medium text-neutral-200">{t("providers.keyInputLegend")}</legend>
				<div role="radiogroup" aria-label={t("providers.keyInputLegend")} className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{options.map((o) => (
						<label
							key={o.value}
							className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
								mode === o.value
									? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-neutral-100"
									: "hairline bg-[var(--well-bg)] text-neutral-300 hover:bg-[var(--bg-hover)]"
							}`}
						>
							<input
								type="radio"
								name={name}
								value={o.value}
								checked={mode === o.value}
								onChange={() => onModeChange(o.value)}
								className="mt-0.5 accent-[var(--accent)]"
							/>
							<span className="min-w-0">
								<span className="block font-medium">{o.label}</span>
								<span className="block break-words text-[11px] text-neutral-500">{o.hint}</span>
							</span>
						</label>
					))}
				</div>
			</fieldset>

			{mode === "plain" ? (
				<>
					{children}
					<p className="text-[11px] leading-relaxed text-neutral-500">{plainNote ?? t("providers.keyPlainNote", { path: MODELS_YML_PATH })}</p>
				</>
			) : (
				<div className="space-y-2">
					<div>
						<label htmlFor={`${name}-env-name`} className="block text-xs font-medium text-neutral-200">
							{t("providers.envNameLabel")}
						</label>
						<input
							id={`${name}-env-name`}
							type="text"
							value={envName}
							onChange={(e) => onEnvNameChange(e.target.value.trim())}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit?.();
							}}
							spellCheck={false}
							autoCapitalize="characters"
							autoComplete="off"
							aria-invalid={showProblem}
							placeholder={t("providers.envNamePlaceholder")}
							className="mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
						/>
						{status !== undefined && (
							<div className={`mt-1 text-[11px] ${status === true ? "text-emerald-400" : "text-amber-400"}`}>
								{status === true ? t("providers.envStatusSet", { name: shownName }) : t("providers.envStatusUnset", { name: shownName })}
							</div>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
						<span>{t("providers.envHint")}</span>
						<button
							type="button"
							aria-expanded={howOpen}
							onClick={() => setHowOpen((v) => !v)}
							className="rounded-full hairline bg-[var(--well-bg)] px-2 py-0.5 text-neutral-300 hover:bg-[var(--bg-hover)]"
						>
							{howOpen ? t("providers.envHowHide") : t("providers.envHowShow")}
						</button>
					</div>
					{howOpen && (
						<ul className="list-disc space-y-1 rounded-lg hairline bg-[var(--well-bg)] py-2 pl-7 pr-3 text-[11px] leading-relaxed text-neutral-400">
							<li>{t("providers.envExplainWhere")}</li>
							<li>{t("providers.envExplainFix")}</li>
						</ul>
					)}
				</div>
			)}

			{showProblem && problem && (
				<div role="alert" className="select-text break-words text-[11px] text-rose-300">
					{t(problemKey[problem])}
				</div>
			)}
		</div>
	);
}
