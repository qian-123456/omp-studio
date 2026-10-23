/** Turn-checkpoint helpers for the git feature ([C] turn nav, contract §session-entry). */

import type { TurnCheckpoint } from "../../lib/contracts";

/**
 * sha → turn map for timeline rows. A commit made during an agent turn shows
 * 「来自对话」. Turns are oldest first; commits are listed newest-first inside a
 * turn, and overlapping turns keep the earliest matching turn.
 */
export function shaToTurnMap(turns: TurnCheckpoint[]): Map<string, TurnCheckpoint> {
	const map = new Map<string, TurnCheckpoint>();
	for (const turn of turns) {
		for (const sha of turn.commits) {
			if (!map.has(sha)) map.set(sha, turn);
		}
	}
	return map;
}

/**
 * One-line turn prompt for display: inline image markers
 * (`[Image #1, 2560x1486: /long/path.png]`, `[图片: path]`) collapse to the
 * composer's `🖼️#N` token. A marker cut off by the stored-prompt truncation
 * (no closing `]`) collapses too.
 */
export function promptPreview(prompt: string): string {
	return prompt
		.replace(/\[Image\s*#(\d+)[^\]]*(?:\]|$)/g, "🖼️#$1")
		.replace(/\[图片(?:\s*#(\d+))?\s*:[^\]]*(?:\]|$)/g, (_m, n?: string) => (n ? `🖼️#${n}` : "🖼️"))
		.trim();
}
