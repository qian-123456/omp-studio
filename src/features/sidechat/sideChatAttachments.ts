import type { ImageAttachment } from "../../lib/contracts";
import type { ComposerImage } from "../../stores/composer";


/** Insert one image token at the current caret, replacing the selection. */
export function insertSideChatImageMarker(
	text: string,
	marker: string,
	start: number,
	end = start,
): { text: string; cursor: number } {
	const from = Math.max(0, Math.min(start, text.length));
	const to = Math.max(from, Math.min(end, text.length));
	const before = text.slice(0, from);
	const after = text.slice(to);
	const spacerBefore = before.length > 0 && !/[ \n]$/u.test(before) ? " " : "";
	const spacerAfter = /^[ \n]/u.test(after) ? "" : " ";
	const inserted = `${spacerBefore}${marker}${spacerAfter}`;
	return { text: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}

/** Hide inline image markers in the blank-tab pending preview; thumbnails show them instead. */
export function sideChatPreviewText(text: string): string {
	return text.replace(/\s*🖼️\s*#\d+/gu, "").trim();
}

/** Drop an attachment token and renumber later tokens after its image is removed. */
export function removeSideChatImageToken(text: string, removedIndex: number): string {
	return text
		.replace(/🖼️\s*#(\d+)/gu, (token, rawIndex: string) => {
			const index = Number(rawIndex);
			if (index === removedIndex) return "";
			return index > removedIndex ? `🖼️#${index - 1}` : token;
		})
		.replace(/ {2,}/gu, " ")
		.replace(/ *\n */gu, "\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

/** Native file drops carry paths; accept only supported image extensions. */
export function isSideChatImagePath(path: string): boolean {
	return /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif)$/iu.test(path);
}

/** Read pasted/dropped image bytes without relying on a webview File path. */
export function imageFileToBase64(file: Blob): Promise<string> {
	// The supported webview/TS target does not provide Promise.withResolvers.
	// Keep the constructor here instead of raising the application's target.
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			resolve(comma >= 0 ? result.slice(comma + 1) : result);
		};
		reader.onerror = () => reject(reader.error ?? new Error("unable to read image"));
		reader.readAsDataURL(file);
	});
}

/** Convert composer images into the attachment shape used by live user echoes. */
export function sideChatImageAttachments(images: readonly ComposerImage[]): ImageAttachment[] {
	return images.map((image, index) => ({
		id: image.id || `img-${index + 1}`,
		path: image.path,
		marker: `[Image #${index + 1}]`,
		...(image.width !== undefined ? { width: image.width } : {}),
		...(image.height !== undefined ? { height: image.height } : {}),
	}));
}

