/** Expand composer image tokens into the wire form omp reads. */

export const IMAGE_TOKEN_PALETTES = [
	{ text: "text-amber-400", decoration: "decoration-amber-400", hex: "#fbbf24" },
	{ text: "text-sky-400", decoration: "decoration-sky-400", hex: "#38bdf8" },
	{ text: "text-emerald-400", decoration: "decoration-emerald-400", hex: "#34d399" },
	{ text: "text-purple-400", decoration: "decoration-purple-400", hex: "#c084fc" },
	{ text: "text-rose-400", decoration: "decoration-rose-400", hex: "#fb7185" },
	{ text: "text-teal-400", decoration: "decoration-teal-400", hex: "#2dd4bf" },
	{ text: "text-yellow-300", decoration: "decoration-yellow-300", hex: "#fde047" },
	{ text: "text-indigo-400", decoration: "decoration-indigo-400", hex: "#818cf8" },
];

export function getImageTokenPalette(index: number) {
	const i = Math.max(1, index);
	return IMAGE_TOKEN_PALETTES[(i - 1) % IMAGE_TOKEN_PALETTES.length];
}

export interface WireImage {
	path: string;
	width?: number;
	height?: number;
}

const TOKEN_RE = /🖼️\s*#(\d+)/gu;

const marker = (n: number, img: WireImage): string => {
	const dim = img.width && img.height ? `, ${img.width}x${img.height}` : "";
	return `[Image #${n}${dim}: ${img.path}]`;
};

/** Replace `🖼️#N` with `[Image #N, WxH: path]`. Tokens with no attachment stay `[Image #N]`. */
export function expandImageTokens(text: string, images: readonly WireImage[]): string {
	return text.replace(TOKEN_RE, (_m, num: string) => {
		const n = parseInt(num, 10);
		const img = images[n - 1];
		return img?.path ? marker(n, img) : `[Image #${n}]`;
	});
}

/**
 * Expand tokens, then add markers for attached images the text no longer
 * references (deleted token). `position` keeps a leading `/command` intact
 * when markers go to the end.
 */
export function expandImagesForSend(
	text: string,
	images: readonly WireImage[],
	position: "prefix" | "suffix" = "prefix",
): string {
	let out = expandImageTokens(text, images);
	const missing = images
		.map((img, i) => ({ img, n: i + 1 }))
		.filter(({ n }) => !out.includes(`[Image #${n}`))
		.map(({ img, n }) => marker(n, img))
		.join(" ");
	if (!missing) return out;
	if (!out.trim()) return missing;
	out = position === "prefix" ? `${missing} ${out}` : `${out.trimEnd()} ${missing}`;
	return out;
}
