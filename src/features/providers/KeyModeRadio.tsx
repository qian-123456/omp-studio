import type { KeyMode } from "../../lib/contracts";
import { useT } from "../../stores/language";
import { MODELS_YML_PATH, VAULT_PATH } from "./keyState";
/** 密钥保存方式: shared by the add/edit form, 设置密钥 and .env import. */
export function KeyModeRadio({
	name,
	value,
	onChange,
}: {
	name: string;
	value: KeyMode;
	onChange: (next: KeyMode) => void;
}) {
	const { t } = useT();
	const options: { value: KeyMode; label: string; hint: string }[] = [
		{
			value: "plaintext",
			label: t("providers.keyModePlaintext"),
			hint: t("providers.keyModePlaintextHint", { path: MODELS_YML_PATH }),
		},
		{
			value: "encrypted",
			label: t("providers.keyModeEncrypted"),
			hint: t("providers.keyModeEncryptedHint", { path: VAULT_PATH }),
		},
	];

	return (
		<fieldset>
			<legend className="text-xs font-medium text-neutral-200">{t("providers.keyModeLegend")}</legend>
			<div className="mt-1.5 space-y-1">
				{options.map((o) => (
					<label key={o.value} className="flex cursor-pointer items-start gap-2 text-xs text-neutral-300">
						<input
							type="radio"
							name={name}
							value={o.value}
							checked={value === o.value}
							onChange={() => onChange(o.value)}
							className="mt-0.5 accent-[var(--accent)]"
						/>
						<span>
							<span className="block">{o.label}</span>
							<span className="block text-[11px] text-neutral-500">{o.hint}</span>
						</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
