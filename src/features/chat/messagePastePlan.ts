/** Re-create a copied message in the composer: its text and images in their
 * original order. `raw` is the message text with `🖼️#N` / `[Image #N]`
 * markers; `paths[N-1]` is the file behind marker N. */

export type PastePiece = { kind: "text"; text: string } | { kind: "image"; path: string };

const IMAGE_MARKER_RE =
	/\[(?:Image|图片)\s*#(\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|🖼️\s*#(\d+)/gu;
/** Non-image noise that must not be pasted as prose (file chips, bare image tags). */
const NOISE_RE = /\[(?:File|文件)\s*#\d+(?::\s*[^\]]+)?\]|📎\s*#\d+|\[图片(?::\s*[^\]]+)?\]/gu;

export function planMessagePaste(raw: string, paths: string[]): PastePiece[] {
	const pieces: PastePiece[] = [];
	const used = new Set<number>();
	const pushText = (s: string) => {
		const text = s.replace(NOISE_RE, "").trim();
		if (text) pieces.push({ kind: "text", text });
	};
	let last = 0;
	for (const m of raw.matchAll(IMAGE_MARKER_RE)) {
		const at = m.index ?? 0;
		pushText(raw.slice(last, at));
		last = at + m[0].length;
		const idx = Number.parseInt(m[1] ?? m[2] ?? "", 10) - 1;
		const path = paths[idx];
		if (path && !used.has(idx)) {
			used.add(idx);
			pieces.push({ kind: "image", path });
		}
	}
	pushText(raw.slice(last));
	// Images the text never referenced still travel with the message.
	paths.forEach((path, idx) => {
		if (!used.has(idx)) pieces.push({ kind: "image", path });
	});
	return pieces;
}
