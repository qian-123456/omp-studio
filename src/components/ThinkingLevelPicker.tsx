/** Thinking-level chip + popover shared by the main composer, the side chat,
 * schedules and settings. The visible label is the raw omp level name
 * (low/high/xhigh/…, matching the omp TUI); descriptions are tooltips /
 * secondary row text. When there are no levels the chip never disappears: it
 * is 「未配置思考等级」 (reasoning model, opens settings) or 「不支持思考」. */

import clsx from "clsx";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { openSettingsTarget } from "../features/settings/settingsTargets";
import { thinkingChipState } from "../lib/models";
import { EffortSlider } from "./EffortSlider";
import { FloatingLayer } from "./FloatingLayer";
import { tNow, useT } from "../stores/language";

export function thinkingLabel(level: string): { label: string; desc: string } {
	switch (level) {
		case "auto":
			return { label: level, desc: tNow("components.thinkingAuto") };
		case "off":
			return { label: level, desc: tNow("components.thinkingOff") };
		case "minimal":
			return { label: level, desc: tNow("components.thinkingMinimal") };
		case "low":
			return { label: level, desc: tNow("components.thinkingLow") };
		case "medium":
			return { label: level, desc: tNow("components.thinkingMedium") };
		case "high":
			return { label: level, desc: tNow("components.thinkingHigh") };
		case "xhigh":
			return { label: level, desc: tNow("components.thinkingXhigh") };
		case "max":
			return { label: level, desc: tNow("components.thinkingMax") };
		default:
			return { label: level, desc: "" };
	}
}

export function ThinkingLevelPicker({
	levels,
	reasoning,
	value,
	open,
	onOpenChange,
	onSelect,
	onConfigure = () => openSettingsTarget("providers"),
	tight = false,
	variant = "ghost",
}: {
	/** Resolved levels (`resolveThinkingLevels`); empty = no levels for this model. */
	levels: string[];
	/** Catalog `reasoning` flag of the selected model; decides the chip when `levels` is empty. */
	reasoning?: boolean | null;
	value: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A level was picked (list or slider). The popover stays open; the list
	 * closes itself. Callers must not close it here. */
	onSelect: (level: string) => void;
	/** Opens model settings from the 「未配置思考等级」 chip; defaults to Settings ▸ API 供应商. */
	onConfigure?: () => void;
	/** Tighter horizontal padding for a crowded toolbar. */
	tight?: boolean;
	/** Visual style: "ghost" for flat toolbars (Composer), "pill" for forms & settings. */
	variant?: "ghost" | "pill";
}) {
	const { t } = useT();
	const ref = useRef<HTMLDivElement>(null);
	const cur = thinkingLabel(value);
	const chip = thinkingChipState(levels, reasoning);
	if (chip.kind === "unsupported") {
		return (
			<span
				title={t("components.thinkingUnsupportedTip")}
				className={clsx(
					"shrink-0 select-none",
					variant === "pill"
						? "flex h-8 items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 text-xs text-neutral-500 opacity-60"
						: "rounded-full bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-30,var(--text-dim))]",
				)}
			>
				{t("components.thinkingUnsupported")}
			</span>
		);
	}
	if (chip.kind === "unconfigured") {
		return (
			<button
				type="button"
				onClick={onConfigure}
				title={t("components.thinkingUnconfiguredTip")}
				className={clsx(
					"shrink-0 select-none transition-colors",
					variant === "pill"
						? "flex h-8 items-center gap-1 rounded-lg border border-dashed border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-2.5 text-xs text-amber-400/90 hover:border-amber-400 hover:text-amber-300"
						: "rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-40,var(--text-dim))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
				)}
			>
				{t("components.thinkingUnconfigured")}
			</button>
		);
	}
	return (
		<div className="relative shrink-0" ref={ref}>
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				title={t("components.thinkingLevelTitle", { label: cur.label, desc: cur.desc ? ` (${cur.desc})` : "" })}
				className={clsx(
					"flex select-none items-center transition-colors",
					variant === "pill"
						? "h-8 gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] active:scale-[0.98]"
						: clsx(
								"gap-1 rounded-md py-1 text-[12px] text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
								tight ? "px-1.5" : "px-2",
						  ),
				)}
			>
				{variant === "pill" ? (
					<>
						<span className="text-neutral-400">{t("components.thinking")}</span>
						<span className="font-mono text-neutral-200">{cur.label}</span>
						<ChevronDown size={11} className="shrink-0 text-neutral-500" />
					</>
				) : (
					<>
						<span>{cur.label}</span>
						<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
					</>
				)}
			</button>
			{open && (
				<FloatingLayer
					anchor={ref.current}
					placement="top-start"
					offset={6}
					layer="popover"
					ignoreRefs={[ref]}
					onDismiss={() => onOpenChange(false)}
					className="w-[288px] max-w-[calc(100vw-16px)] rounded-2xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)]"
				>
					<ThinkingLevelControl levels={levels} value={value} onSelect={onSelect} />
				</FloatingLayer>
			)}
		</div>
	);
}

const KNOWN_LEVELS: Record<string, true> = {
	auto: true,
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
};

/** Display form of a level in the card's status line: known names get a
 * capital first letter; unknown names are shown exactly as stored. */
function statusName(level: string): string {
	return Object.prototype.hasOwnProperty.call(KNOWN_LEVELS, level)
		? level.charAt(0).toUpperCase() + level.slice(1)
		: level;
}

/** Compact control body: status button + description + effort slider. The full
 * text list is a separate floating menu above the status button, so opening it
 * never changes the card geometry. Mounted only while its host is open, so a
 * slider preview never outlives it. A list pick closes only the list; the
 * slider commit changes nothing but the level (its max effect stays visible). */
function ThinkingLevelControl({
	levels,
	value,
	onSelect,
}: {
	levels: string[];
	value: string;
	onSelect: (level: string) => void;
}) {
	const { t } = useT();
	// Level the slider shows ahead of `value`: while dragging, and after a commit
	// until the caller reports the new value.
	const [preview, setPreview] = useState<string | null>(null);
	useEffect(() => setPreview(null), [value]);
	const [listOpen, setListOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const listId = useId();
	const shown = preview ?? value;
	const stops = levels.filter((level) => level !== "auto");
	const cur = thinkingLabel(shown);
	const commit = (index: number) => {
		const level = stops[index];
		if (level === undefined || level === value) setPreview(null);
		else onSelect(level);
	};
	const pick = (level: string) => {
		setListOpen(false);
		buttonRef.current?.focus();
		if (level !== value) onSelect(level);
	};
	const focusItem = (i: number) => {
		const n = levels.length;
		itemRefs.current[(i + n) % n]?.focus();
	};
	return (
		<div className="px-3 py-2.5">
			<div className="flex justify-center">
				<button
					ref={buttonRef}
					type="button"
					aria-haspopup="menu"
					aria-expanded={listOpen}
					aria-controls={listOpen ? listId : undefined}
					aria-label={`${t("components.thinkingLevel")}: ${statusName(shown)}`}
					onClick={() => setListOpen((v) => !v)}
					onKeyDown={(e) => {
						if (e.key === "ArrowUp" || e.key === "ArrowDown") {
							e.preventDefault();
							setListOpen(true);
						}
					}}
					className="flex min-h-8 items-center gap-1 whitespace-nowrap px-1.5 text-[15px] font-medium text-[var(--accent)] transition-colors hover:opacity-80 focus-visible:rounded focus-visible:outline-2 focus-visible:outline-[var(--accent)] pointer-coarse:min-h-11"
				>
					<span>{statusName(shown)}</span>
					<ChevronRight size={13} className="shrink-0" />
				</button>
			</div>
			{cur.desc && (
				<div className="mt-0.5 text-center text-[13px] text-[var(--text-40,var(--text-dim))]">{cur.desc}</div>
			)}
			{stops.length > 0 && (
				<div className="mt-2">
					<EffortSlider
						count={stops.length}
						value={stops.indexOf(shown)}
						label={t("components.thinkingLevel")}
						valueText={shown}
						onPreview={(index) => setPreview(stops[index] ?? null)}
						onCommit={commit}
						onCancel={() => setPreview(null)}
					/>
				</div>
			)}
			{listOpen && (
				<FloatingLayer
					anchor={buttonRef.current}
					placement="top-start"
					offset={6}
					layer="menu"
					role="menu"
					aria-label={t("components.thinkingLevel")}
					ignoreRefs={[buttonRef]}
					onDismiss={() => {
						setListOpen(false);
					}}
					className="w-[260px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1"
				>
					<div id={listId}>
						<div className="border-b border-[var(--line,var(--border-divider))] px-3 py-2 text-[13px] text-[var(--text-40,var(--text-dim))]">
							{t("components.thinkingLevel")}
						</div>
						<div className="py-0.5">
							{levels.map((level, i) => {
								const opt = thinkingLabel(level);
								return (
									<button
										key={level}
										ref={(el) => {
											itemRefs.current[i] = el;
										}}
										type="button"
										role="menuitemradio"
										aria-checked={value === level}
										onClick={() => pick(level)}
										onKeyDown={(e) => {
											if (e.key === "ArrowDown") {
												e.preventDefault();
												focusItem(i + 1);
											} else if (e.key === "ArrowUp") {
												e.preventDefault();
												focusItem(i - 1);
											} else if (e.key === "Escape") {
												e.preventDefault();
												setListOpen(false);
												buttonRef.current?.focus();
											}
										}}
										className={clsx(
											"flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
											shown === level
												? "bg-[var(--bg-active-fill)] text-[var(--text)]"
												: "text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
										)}
									>
										<div className="min-w-0 pr-2">
											<div className="font-medium">{opt.label}</div>
											{opt.desc && <div className="text-xs text-[var(--text-40,var(--text-dim))]">{opt.desc}</div>}
										</div>
										{value === level && <Check size={15} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />}
									</button>
								);
							})}
						</div>
					</div>
				</FloatingLayer>
			)}
		</div>
	);
}

/** Inline thinking-level control for popovers where the separate chip has been
 * merged into the model chip. Same states as the chip: levels from the
 * catalog, 「不支持思考」, or 「未配置思考等级」 (opens settings). */
export function ThinkingLevelStrip({
	levels,
	reasoning,
	value,
	onSelect,
	onConfigure = () => openSettingsTarget("providers"),
}: {
	levels: string[];
	reasoning?: boolean | null;
	value: string;
	onSelect: (level: string) => void;
	onConfigure?: () => void;
}) {
	const { t } = useT();
	const chip = thinkingChipState(levels, reasoning);
	if (chip.kind === "levels") {
		return (
			<div className="border-t border-[var(--line,var(--border-divider))]">
				<ThinkingLevelControl levels={chip.levels} value={value} onSelect={onSelect} />
			</div>
		);
	}
	return (
		<div className="border-t border-[var(--line,var(--border-divider))] px-2.5 py-2">
			<div className="pb-1 text-[11px] text-[var(--text-40,var(--text-dim))]">{t("components.thinkingLevel")}</div>
			{chip.kind === "unsupported" && (
				<span className="inline-block shrink-0 whitespace-nowrap rounded-full bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-30,var(--text-dim))]">
					{t("components.thinkingUnsupported")}
				</span>
			)}
			{chip.kind === "unconfigured" && (
				<button
					type="button"
					onClick={onConfigure}
					title={t("components.thinkingUnconfiguredTip")}
					className="shrink-0 whitespace-nowrap rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-40,var(--text-dim))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
				>
					{t("components.thinkingUnconfigured")}
				</button>
			)}
		</div>
	);
}
