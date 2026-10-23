/** [B] Atomic command token rendered inline at the start of the composer
 * input (icon + label). Display-only: it lives in the mirror layer behind the
 * textarea like image placeholders, and a Backspace at the start of the args
 * deletes it whole. Skills show a coloured icon + bare skill name. */

import { chipIcon, chipLabel, isSkillChip, type CommandChip } from "./chip";

export function CommandChipBadge({ chip }: { chip: CommandChip }) {
	const Icon = chipIcon(chip);
	const skill = isSkillChip(chip);
	const tone = skill ? "text-violet-500" : "text-[var(--text-60,var(--text-muted))]";
	return (
		<span
			data-command-chip={chip.name}
			title={`/${chip.name}${chip.sub ? ` ${chip.sub}` : ""}`}
			className={`inline-flex items-center gap-1 align-top font-medium select-none ${skill ? "text-violet-500" : "text-[var(--text)]"}`}
		>
			<Icon size={13} className={`shrink-0 self-center ${tone}`} />
			<span className="whitespace-nowrap">{chipLabel(chip)}</span>
		</span>
	);
}
