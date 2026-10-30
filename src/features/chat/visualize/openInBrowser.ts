import { openPath } from "@tauri-apps/plugin-opener";
import { saveClipboardFile } from "../../../lib/ipc";

/** UTF-8 string → base64 (chunked so large documents don't overflow the arg limit). */
export function utf8ToBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

/**
 * Persist a standalone HTML document via the backend cache-file command (keeps
 * the `.html` extension) and open it with the OS default handler.
 */
export async function openHtmlInBrowser(doc: string): Promise<string> {
	const path = await saveClipboardFile(utf8ToBase64(doc), `visualize-${Date.now()}.html`);
	await openPath(path);
	return path;
}
