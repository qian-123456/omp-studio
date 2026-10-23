import type { KeyMode } from "../../lib/contracts";
import { MODELS_YML_PATH, VAULT_PATH } from "./keyState";

const OPTIONS: { value: KeyMode; label: string; hint: string }[] = [
	{
		value: "plaintext",
		label: "明文写入 OMP 配置（OMP 默认）",
		hint: `密钥直接写进 ${MODELS_YML_PATH}`,
	},
	{
		value: "encrypted",
		label: "加密保存",
		hint: `密钥加密存于 ${VAULT_PATH}，OMP 使用时才解密`,
	},
];

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
	return (
		<fieldset>
			<legend className="text-xs font-medium text-neutral-200">密钥保存方式</legend>
			<div className="mt-1.5 space-y-1">
				{OPTIONS.map((o) => (
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
