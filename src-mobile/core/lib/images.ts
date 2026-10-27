/** Image helpers for the prompt-ex contract (chat.rs): `images: [{mime, data}]` with BARE base64. */

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const UNSUPPORTED_IMAGE = "仅支持 png/jpeg/gif/webp 图片";

export interface PromptImage {
	mime: string;
	data: string;
}

/** Lower-cases and folds `image/jpg` into `image/jpeg`. */
export function imageMime(raw: unknown): string {
	const mime = String(raw ?? "").toLowerCase();
	return mime === "image/jpg" ? "image/jpeg" : mime;
}

const isSupported = (mime: string) => (IMAGE_MIMES as readonly string[]).includes(mime);

/** Convert `data:image/...;base64,...` into `{mime, data}`; null when malformed or unsupported. */
export function imageFromDataUrl(url: unknown): PromptImage | null {
	if (typeof url !== "string") return null;
	const m = /^data:([^;,]+);(?:[^;,]*;)*base64,/i.exec(url);
	if (!m) return null;
	const mime = imageMime(m[1]);
	const data = url.slice(m[0].length);
	if (!isSupported(mime) || !data) return null;
	return { mime, data };
}

/** Read a pasted/picked image Blob into `{mime, data}`; rejects unsupported types. */
export function imageFromBlob(blob: Blob): Promise<PromptImage> {
	return new Promise((resolve, reject) => {
		const mime = imageMime(blob?.type);
		if (!isSupported(mime)) return reject(new Error(UNSUPPORTED_IMAGE));
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("无法读取图片"));
		reader.onload = () => {
			const raw = String(reader.result ?? "");
			const at = raw.indexOf(",");
			if (at < 0) return reject(new Error("无法读取图片"));
			resolve({ mime, data: raw.slice(at + 1) });
		};
		reader.readAsDataURL(blob);
	});
}

/** Validate/normalize a mixed list ({mime,data} | data: URL) for prompt-ex; throws on a bad item. */
export function normalizeImages(list: ReadonlyArray<PromptImage | string | null | undefined>): PromptImage[] {
	const out: PromptImage[] = [];
	for (const img of list) {
		if (!img) continue;
		if (typeof img === "string") {
			const parsed = imageFromDataUrl(img);
			if (!parsed) throw new Error(UNSUPPORTED_IMAGE);
			out.push(parsed);
			continue;
		}
		const mime = imageMime(img.mime);
		if (!isSupported(mime)) throw new Error(UNSUPPORTED_IMAGE);
		let data: unknown = img.data;
		if (typeof data === "string" && data.startsWith("data:")) {
			const parsed = imageFromDataUrl(data);
			if (!parsed) throw new Error(UNSUPPORTED_IMAGE);
			data = parsed.data;
		}
		if (typeof data !== "string" || !data) throw new Error("图片数据为空");
		out.push({ mime, data });
	}
	return out;
}

/** `data:` URL for rendering a prompt image locally (preview before send). */
export const toDataUrl = (img: PromptImage): string => `data:${img.mime};base64,${img.data}`;
