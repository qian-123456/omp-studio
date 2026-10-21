/** Slash-menu entries for skills on disk, used while omp has not told us its
 * command list yet (the session has no running process: omp is spawned lazily
 * on the first send, and only a live process advertises `skill:*` commands). */

import type { SkillItem } from "../../../lib/contracts";
import type { SlashCommand } from "../../../stores/live";

export function skillCommandsFromCatalog(skills: SkillItem[]): SlashCommand[] {
	const seen = new Set<string>();
	const out: SlashCommand[] = [];
	for (const s of skills) {
		const name = `skill:${s.name}`;
		if (!s.name || seen.has(name)) continue;
		seen.add(name);
		// Same hint omp advertises for skills: choosing one starts a skill chip that
		// waits for the user's arguments instead of sending a bare `/skill:x`.
		out.push({ name, description: s.description || undefined, hint: "arguments", source: "skill" });
	}
	return out;
}
