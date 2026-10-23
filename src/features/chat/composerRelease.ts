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

const IMG_TOKEN_RE = /(🖼️\s*#|\[(?:Image|图片)\s*#)(\d+)\b/gu;
const FILE_TOKEN_RE = /(📎\s*#|\[(?:File|文件)\s*#)(\d+)\b/gu;

function tokenNumbers(text: string, re: RegExp): Set<number> {
	const out = new Set<number>();
	for (const m of text.matchAll(re)) out.add(Number(m[2]));
	return out;
}

function mapTokenNumbers(text: string, re: RegExp, map: (n: number) => number): string {
	return text.replace(re, (_m, prefix: string, num: string) => `${prefix}${map(Number(num))}`);
}

/** Attachments that still have a token in `text`, as 0-based indexes; null = all kept. */
function keptIndexes(present: Set<number>, count: number): number[] | null {
	const kept: number[] = [];
	for (let i = 0; i < count; i++) if (present.has(i + 1)) kept.push(i);
	return kept.length === count ? null : kept;
}

/** Renumber tokens so `#k` points at the k-th kept attachment (old index → rank + 1). */
function compactTokens(text: string, re: RegExp, kept: number[]): string {
	const rank = new Map(kept.map((oldIdx, r) => [oldIdx + 1, r + 1]));
	return mapTokenNumbers(text, re, (n) => rank.get(n) ?? n);
}

export interface AttachmentSync {
	text: string;
	/** 0-based image indexes to keep; null = keep every image. */
	images: number[] | null;
	/** 0-based file indexes to keep; null = keep every file. */
	files: number[] | null;
}

/**
 * After a free-form edit (selection delete, cut) some `🖼️#N` / `📎#N` tokens
 * may be gone. Attachments without a token are dropped and the surviving
 * tokens are renumbered so they keep pointing at the same attachment.
 */
export function syncAttachmentTokens(
	text: string,
	imageCount: number,
	fileCount: number,
): AttachmentSync {
	const images = keptIndexes(tokenNumbers(text, IMG_TOKEN_RE), imageCount);
	const files = keptIndexes(tokenNumbers(text, FILE_TOKEN_RE), fileCount);
	let next = text;
	if (images) next = compactTokens(next, IMG_TOKEN_RE, images);
	if (files) next = compactTokens(next, FILE_TOKEN_RE, files);
	return { text: next, images, files };
}

/**
 * Restore a failed send: put the original `raw` back in front of whatever the
 * user typed meanwhile. The newer draft's tokens point at attachments added
 * after the sent ones, so they shift up by the restored counts.
 */
export function mergeFailedDraft(
	raw: string,
	cur: string,
	restoredImages: number,
	restoredFiles: number,
): string {
	if (cur.trim() === "") return raw;
	let shifted = cur;
	if (restoredImages > 0) shifted = mapTokenNumbers(shifted, IMG_TOKEN_RE, (n) => n + restoredImages);
	if (restoredFiles > 0) shifted = mapTokenNumbers(shifted, FILE_TOKEN_RE, (n) => n + restoredFiles);
	return `${raw.replace(/\s+$/, "")}\n${shifted}`;
}
