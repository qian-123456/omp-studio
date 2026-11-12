import { validatePath } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";

/** Toast text for an unusable image token, or null when the file is usable. */
export function imageUnavailableMessage(
	path: string | null | undefined,
	exists: boolean | null,
): string | null {
	if (!path) return tNow("chat.noImageSent");
	return exists === false ? tNow("chat.imageDeleted") : null;
}

/**
 * Resolve a token against its explicit attachment marker (or a legacy positional
 * slot), then open its path-filtered gallery index. Never substitute another image.
 */
export async function openImageOrExplain(
	images: ReadonlyArray<{ path?: string | null; marker?: string | null }>,
	num: number,
	open: (index: number) => void,
): Promise<void> {
	let index = -1;
	if (Number.isInteger(num) && num >= 1) {
		index = images.findIndex((image) =>
			Number(image.marker?.match(/^\[(?:Image|图片)\s*#(\d+)\b/)?.[1]) === num);
		// Prefer explicit identity even if an unnumbered legacy image occurs earlier.
		if (index < 0 && images[num - 1] &&
			!images[num - 1].marker?.match(/^\[(?:Image|图片)\s*#\d+\b/)) index = num - 1;
	}
	const path = images[index]?.path;
	let exists: boolean | null = null;
	if (path) {
		try {
			exists = (await validatePath(path)).exists;
		} catch {
			exists = null;
		}
	}
	const msg = imageUnavailableMessage(path, exists);
	if (msg) toast.info(msg);
	else {
		let previewIndex = 0;
		for (let i = 0; i < index; i++) if (images[i].path) previewIndex++;
		open(previewIndex);
	}
}
