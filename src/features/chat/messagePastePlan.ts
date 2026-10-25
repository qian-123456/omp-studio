/** Re-create a copied message in the composer: its text, images and file
 * attachments in their original order. `raw` is the message text with
 * `🖼️#N` / `[Image #N]` image markers and `📎#N` / `[File #N: path]` file
 * markers; `paths[N-1]` is the image behind image marker N. A file marker
 * carries its own path when it has one, else `files[N-1]` is used. */

export type PastePiece =
	| { kind: "text"; text: string }
	| { kind: "image"; path: string }
	| { kind: "file"; path: string };

const MARKER_RE =
	/\[(?:Image|图片)\s*#(?<img1>\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|🖼️\s*#(?<img2>\d+)|\[(?:File|文件)\s*#(?<file1>\d+)(?::\s*(?<path1>[^\]]+))?\]|📎\s*#(?<file2>\d+)/gu;
/** Non-attachment noise that must not be pasted as prose (bare image tags). */
const NOISE_RE = /\[图片(?::\s*[^\]]+)?\]/gu;

export function planMessagePaste(raw: string, paths: string[], files: string[] = []): PastePiece[] {
	const pieces: PastePiece[] = [];
	const usedImages = new Set<number>();
	const usedFiles = new Set<string>();
	const pushText = (s: string) => {
		const text = s.replace(NOISE_RE, "").trim();
		if (text) pieces.push({ kind: "text", text });
	};
	let last = 0;
	for (const m of raw.matchAll(MARKER_RE)) {
		const at = m.index ?? 0;
		pushText(raw.slice(last, at));
		last = at + m[0].length;
		const g = m.groups ?? {};
		const imgNum = g.img1 ?? g.img2;
		if (imgNum !== undefined) {
			const idx = Number.parseInt(imgNum, 10) - 1;
			const path = paths[idx];
			if (path && !usedImages.has(idx)) {
				usedImages.add(idx);
				pieces.push({ kind: "image", path });
			}
			continue;
		}
		const num = Number.parseInt(g.file1 ?? g.file2 ?? "", 10);
		const path = g.path1?.trim() || files[num - 1];
		if (path && !usedFiles.has(path)) {
			usedFiles.add(path);
			pieces.push({ kind: "file", path });
		}
	}
	pushText(raw.slice(last));
	// Attachments the text never referenced still travel with the message.
	paths.forEach((path, idx) => {
		if (!usedImages.has(idx)) pieces.push({ kind: "image", path });
	});
	for (const path of files) {
		if (!usedFiles.has(path)) {
			usedFiles.add(path);
			pieces.push({ kind: "file", path });
		}
	}
	return pieces;
}
