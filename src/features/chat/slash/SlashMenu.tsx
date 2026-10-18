/** [B] Codex-style slash menu popup: grouped sections, 40px rows,
 * gear button for settings-bound commands, hotkey footer. */

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { Settings2 } from "lucide-react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { openSettingsTarget } from "../../settings/settingsTargets";
import type { SlashMenuItem, SlashMenuSection } from "./menu";

export interface SlashMenuProps {
	anchor: Element | null;
	sections: SlashMenuSection[];
	/** Flat index into all items across sections. */
	activeIndex: number;
	/** Triggered when the query/box is empty but nothing matched. */
	empty: boolean;
	/** Footer hint override (subcommand menu says 选择 rather than 执行). */
	footer?: string;
	onSelect(item: SlashMenuItem): void;
	onDismiss(): void;
}

export function SlashMenu({
	anchor,
	sections,
	activeIndex,
	empty,
	footer = "↑↓ 选择 · ↵ 执行 · Esc 关闭",
	onSelect,
	onDismiss,
}: SlashMenuProps) {
	const listRef = useRef<HTMLDivElement>(null);

	// Keep the active row visible while keyboard-navigating.
	useEffect(() => {
		const el = listRef.current?.querySelector("[data-active='true']");
		el?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	let flatIndex = -1;
	return (
		<FloatingLayer
			anchor={anchor}
			placement="top-start"
			offset={6}
			layer="popover"
			onDismiss={onDismiss}
			className="w-[min(calc(100vw-32px),560px)] !overflow-hidden rounded-xl border-[var(--line,var(--border))] !bg-[var(--bg-panel)] p-1"
			role="listbox"
			aria-label="斜杠命令"
		>
			<div ref={listRef} className="max-h-[min(50vh,420px)] overflow-y-auto">
				{empty ? (
					<div className="px-3 py-2.5 text-[12px] text-[var(--text-40,var(--text-dim))]">
						无匹配命令
					</div>
				) : (
					sections.map((section) => (
						<div key={section.label}>
							<div className="px-2 pb-0.5 pt-1.5 text-[12px] text-[var(--text-30,var(--text-dim))]">
								{section.label}
							</div>
							{section.items.map((item) => {
								flatIndex += 1;
								const active = flatIndex === activeIndex;
								return (
									<SlashRow
										key={item.subOf ? `${item.subOf} ${item.name}` : item.name}
										item={item}
										active={active}
										onSelect={onSelect}
										onDismiss={onDismiss}
									/>
								);
							})}
						</div>
					))
				)}
			</div>
			<div className="border-t border-[var(--line,var(--border-divider))] px-2.5 py-1.5 text-[11px] text-[var(--text-30,var(--text-dim))]">
				{footer}
			</div>
		</FloatingLayer>
	);
}

function SlashRow({
	item,
	active,
	onSelect,
	onDismiss,
}: {
	item: SlashMenuItem;
	active: boolean;
	onSelect(item: SlashMenuItem): void;
	onDismiss(): void;
}) {
	const Icon = item.icon;
	return (
		<div
			data-active={active}
			role="option"
			aria-selected={active}
			className={clsx(
				"group/slashrow flex h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left",
				active
					? "bg-[var(--ghost-hover,var(--bg-hover))]"
					: "hover:bg-[var(--ghost-hover,var(--bg-hover))]",
			)}
			onMouseDown={(e) => {
				e.preventDefault();
				onSelect(item);
			}}
		>
			<Icon
				size={20}
				className="shrink-0 text-[var(--text-40,var(--text-dim))]"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5 text-[13px] leading-5">
					<span className="shrink-0 font-mono text-[var(--text)]">
						{item.plain ? item.name : `/${item.subOf ? `${item.subOf} ${item.name}` : item.name}`}
					</span>
					{item.title && (
						<span className="truncate text-[var(--text-60,var(--text-muted))]">
							{item.title}
						</span>
					)}
				</div>
				{item.description && (
					<div className="truncate text-[11px] leading-4 text-[var(--text-40,var(--text-dim))]">
						{item.description}
					</div>
				)}
			</div>
			{item.argHint && (
				<span className="shrink-0 font-mono text-[11px] text-[var(--text-30,var(--text-dim))]">
					{item.argHint}
				</span>
			)}
			{item.settingsTarget && (
				<button
					type="button"
					title="去设置"
					aria-label={`去设置 ${item.title || item.name}`}
					className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-30,var(--text-dim))] opacity-0 transition-opacity hover:bg-[var(--bg-active-fill)] hover:text-[var(--text)] focus:opacity-100 group-hover/slashrow:opacity-100"
					onMouseDown={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onDismiss();
						openSettingsTarget(item.settingsTarget!);
					}}
				>
					<Settings2 size={12} />
				</button>
			)}
		</div>
	);
}
