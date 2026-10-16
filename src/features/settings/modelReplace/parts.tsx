/**
 * [D] Small pieces shared by the 批量替换模型 dialog steps: buttons, the thinking
 * level select, the catalogue-only target picker and the row badges.
 */
import clsx from "clsx";
import type { ReactNode } from "react";
import { ModelSelect } from "../../../components/ModelSelect";
import { NativeSelect } from "../../../components/NativeSelect";
import type { ModelOption } from "../../../lib/models";
import { MODEL_PICKER_BUTTON_CLASS } from "../ui";
import { THINKING_LEVELS } from "./logic";

export const BTN_PRIMARY =
	"shrink-0 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50";

export const BTN_GHOST =
	"shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50";

export const CHECKBOX_CLASS = "h-3.5 w-3.5 shrink-0";

/** Level picker: 模型默认 (no suffix) plus every known thinking level. */
export function LevelSelect({
	value,
	onChange,
	disabled,
	ariaLabel,
	containerClassName,
}: {
	/** null = 模型默认. */
	value: string | null;
	onChange: (level: string | null) => void;
	disabled?: boolean;
	ariaLabel: string;
	containerClassName?: string;
}) {
	return (
		<NativeSelect
			aria-label={ariaLabel}
			value={value ?? ""}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
			containerClassName={containerClassName}
			className="text-[11px]"
		>
			<option value="">模型默认</option>
			{THINKING_LEVELS.map((level) => (
				<option key={level} value={level}>
					{level}
				</option>
			))}
		</NativeSelect>
	);
}

/** Catalogue-only model picker: no role rows, no custom selectors, no thinking strip. */
export function TargetPicker({
	value,
	models,
	onSelect,
	disabled,
	buttonClass,
	caption,
}: {
	value: string;
	models: ModelOption[] | null;
	onSelect: (modelKey: string) => void;
	disabled?: boolean;
	buttonClass?: string;
	caption?: string;
}) {
	return (
		<ModelSelect
			models={models}
			currentValue={value}
			label={value || "选择目标模型"}
			closeOnSelect
			caption={caption}
			disabled={disabled}
			align="start"
			buttonClass={buttonClass ?? MODEL_PICKER_BUTTON_CLASS}
			onSelect={(key) => onSelect(key)}
		/>
	);
}

export function Chip({
	tone = "neutral",
	title,
	children,
}: {
	tone?: "neutral" | "warn" | "good" | "info";
	title?: string;
	children: ReactNode;
}) {
	return (
		<span
			title={title}
			className={clsx(
				"shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] leading-4",
				tone === "warn" && "bg-amber-500/15 text-amber-300",
				tone === "good" && "bg-emerald-500/15 text-emerald-300",
				tone === "info" && "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)]",
				tone === "neutral" && "bg-[var(--bg-active-fill)] text-neutral-400",
			)}
		>
			{children}
		</span>
	);
}
