import { validatePath } from "../../lib/ipc";
import { toast } from "../../lib/toast";

export const NO_IMAGE_SENT_MSG = "这条消息发送时没有附带图片";
export const IMAGE_DELETED_MSG = "图片文件已被删除";

/** Toast text for an unusable image token, or null when the file is usable. */
export function imageUnavailableMessage(
	path: string | null | undefined,
	exists: boolean | null,
): string | null {
	if (!path) return NO_IMAGE_SENT_MSG;
	return exists === false ? IMAGE_DELETED_MSG : null;
}

/** Click handler body for `🖼️#N` chips: preview when the file exists, otherwise say why not. */
export async function openImageOrExplain(
	paths: ReadonlyArray<string | null | undefined>,
	num: number,
	open: (index: number) => void,
): Promise<void> {
	const index = Math.min(Math.max(num - 1, 0), Math.max(paths.length - 1, 0));
	const path = paths[index];
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
	else open(index);
}
