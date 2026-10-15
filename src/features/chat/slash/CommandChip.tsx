/** [B] Atomic command chip rendered at the start of the composer input.
 * Read-only label + icon + remove button; the composer overlays it over the
 * textarea's indented first line. */

import { X } from "lucide-react";
import { chipIcon, chipLabel, type CommandChip } from "./chip";

export function CommandChipBadge({
	chip,
	onRemove,
}: {
	chip: CommandChip;
	onRemove(): void;
}) {
	const Icon = chipIcon(chip);
	return (
		<span
			data-command-chip={chip.name}
			title={`/${chip.name}`}
			className="inline-flex h-[22px] max-w-full items-center gap-1 rounded-md border border-[var(--line,var(--border))] bg-[var(--bg-hover)] px-1.5 text-[12px] font-medium text-[var(--text)] shadow-sm select-none"
		>
			<Icon size={12} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />
			<span className="min-w-0 truncate">{chipLabel(chip)}</span>
			<button
				type="button"
				onMouseDown={(e) => e.preventDefault()}
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				aria-label={`移除命令 /${chip.name}`}
				className="shrink-0 rounded p-0.5 text-[var(--text-40,var(--text-dim))] transition-colors hover:bg-[var(--bg-active-fill)] hover:text-[var(--text)]"
			>
				<X size={11} />
			</button>
		</span>
	);
}
