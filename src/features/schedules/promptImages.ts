/**
 * Scheduled-task instruction ↔ editable text with image tokens.
 * The stored prompt carries `[Image #N: path]` markers (what the chat composer
 * sends), so the run needs no schema change: the prompt text is the payload.
 * The editor shows the same `🖼️ #N` tokens as the composer. Images exist only
 * through their markers, so deleting a token drops its image.
 */
import { imageTokenRegex, type TokenDoc } from "../backlog/ideaTokens";

const WIRE_RE = /\[(?:Image|图片)\s*#?\d*(?:,\s*\d+x\d+)?:\s*([^\]]+?)\s*\]/gu;

/** Stored prompt → editable doc (tokens + ordered unique image paths). */
export function promptToDoc(prompt: string): TokenDoc {
	const images: string[] = [];
	const text = prompt.replace(WIRE_RE, (_m, path: string) => {
		let i = images.indexOf(path);
		if (i < 0) {
			images.push(path);
			i = images.length - 1;
		}
		return `🖼️ #${i + 1}`;
	});
	return { text, images };
}

/** Editable doc → stored prompt with `[Image #N: path]` markers. Orphan tokens are dropped. */
export function docToPrompt(doc: TokenDoc): string {
	return doc.text.replace(imageTokenRegex(), (_m, n: string) => {
		const p = doc.images[Number(n) - 1];
		return p ? `[Image #${n}: ${p}]` : "";
	});
}
