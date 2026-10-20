/** Draft bookkeeping for a send that was released while the user kept typing. */

const IMG_RE = /\s*(?:🖼️\s*#(\d+)\b|\[(?:Image|图片)\s*#(\d+)(?:,[^\]]*)?(?::[^\]]*)?\])/gu;
const FILE_RE = /\s*(?:📎\s*#(\d+)\b|\[(?:File|文件)\s*#(\d+)(?::[^\]]*)?\])/gu;

function shiftTokens(text: string, re: RegExp, sent: number, glyph: string): string {
	if (sent <= 0) return text;
	return text.replace(re, (_m, a: string | undefined, b: string | undefined) => {
		const n = Number(a ?? b);
		if (n <= sent) return " ";
		return ` ${glyph}#${n - sent}`;
	});
}

/**
 * Remaining draft after a send consumed `raw` plus the first `sentImages` /
 * `sentFiles` attachments: drops the sent prefix, removes tokens that pointed
 * at sent attachments and renumbers later tokens to match the shortened lists.
 */
export function remainingDraft(
	cur: string,
	raw: string,
	sentImages: number,
	sentFiles: number,
): string {
	let rest = cur.startsWith(raw) ? cur.slice(raw.length) : cur;
	rest = shiftTokens(rest, IMG_RE, sentImages, "🖼️");
	rest = shiftTokens(rest, FILE_RE, sentFiles, "📎");
	return rest.trim() === "" ? "" : rest.trimStart();
}
