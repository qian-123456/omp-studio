/** Slash-menu entries for skills on disk, used while omp has not told us its
 * command list yet (the session has no running process: omp is spawned lazily
 * on the first send, and only a live process advertises `skill:*` commands). */

import type { SkillItem } from "../../../lib/contracts";
import {
	DEFAULT_SKILL_CONFIG,
	resolveSkillEnablement,
	type SkillEnableConfig,
} from "../../../lib/skillEnablement";
import type { SlashCommand } from "../../../stores/live";

/** Skills that OMP's filter pipeline disables are left out: omp would not advertise them. */
export function skillCommandsFromCatalog(
	skills: SkillItem[],
	cfg: SkillEnableConfig = DEFAULT_SKILL_CONFIG,
): SlashCommand[] {
	const seen = new Set<string>();
	const out: SlashCommand[] = [];
	for (const s of skills) {
		const name = `skill:${s.name}`;
		if (!s.name || seen.has(name)) continue;
		if (!resolveSkillEnablement(s, cfg).enabled) continue;
		seen.add(name);
		// Same hint omp advertises for skills: choosing one starts a skill chip that
		// waits for the user's arguments instead of sending a bare `/skill:x`.
		out.push({ name, description: s.description || undefined, hint: "arguments", source: "skill" });
	}
	return out;
}
