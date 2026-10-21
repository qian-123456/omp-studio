/** [B] File-attachment token helpers (📎#N) + binary-vs-text sniffing.
 * Mirrors the image-token machinery in Composer.tsx: pasted/dropped files
 * become inline atomic tokens that serialize to `[文件 #N: <path>]` on send. */

export interface InlineFileToken {
	/** The exact matched token text. */
	match: string;
	/** 1-based file number (#N). */
	index: number;
	/** Real filesystem path when the token carries one (`[文件 #N: path]`). */
	path?: string;
}

/**
 * Inline file marker, both forms:
 *   📎#N            — composer draft token
 *   [文件 #N: path]  /  [File #N: path] — serialized / echoed marker
 */
export const INLINE_FILE_RE =
	/(?:\[(?:File|文件)\s*#(?<num1>\d+)(?::\s*(?<path1>[^\]]+))?\]|📎\s*#(?<num2>\d+))/gu;

/** Parse every inline file token out of `text`. */
export function parseInlineFiles(text: string): InlineFileToken[] {
	const tokens: InlineFileToken[] = [];
	const re = new RegExp(INLINE_FILE_RE.source, "gu");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		const numStr = m.groups?.num1 || m.groups?.num2 || "1";
		const num = parseInt(numStr, 10);
		const path = (m.groups?.path1 || "").trim() || undefined;
		tokens.push({ match: m[0], index: num, path });
	}
	return tokens;
}

/**
 * Convert `📎#N` into `[文件 #N: <real path>]` (omp reads the file itself), then
 * add markers for attached files whose token was deleted so nothing silently
 * drops out of the prompt. `position` keeps a leading `/command` intact when
 * markers go to the end.
 */
export function expandFilesForSend(
	text: string,
	files: ReadonlyArray<{ path?: string }>,
	position: "prefix" | "suffix" = "prefix",
): string {
	let out = text.replace(/📎\s*#(\d+)/gu, (_match, numStr: string) => {
		const n = parseInt(numStr, 10);
		const path = files[n - 1]?.path;
		return path ? `[文件 #${n}: ${path}]` : `[文件 #${n}]`;
	});
	const missing = files
		.map((f, i) => ({ f, n: i + 1 }))
		.filter(({ n }) => !out.includes(`[文件 #${n}`))
		.map(({ f, n }) => `[文件 #${n}: ${f.path}]`)
		.join(" ");
	if (!missing) return out;
	if (!out.trim()) return missing;
	out = position === "prefix" ? `${missing} ${out}` : `${out.trimEnd()} ${missing}`;
	return out;
}

/** Byte ranges of every inline file token (caret snapping / atomic delete). */
export function getFileTokenRanges(content: string): Array<{
	start: number;
	end: number;
	num: number;
	token: string;
}> {
	const ranges: Array<{ start: number; end: number; num: number; token: string }> = [];
	const re = new RegExp(INLINE_FILE_RE.source, "gu");
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		const numMatch = /\d+/.exec(match[0]);
		const num = numMatch ? parseInt(numMatch[0], 10) : 1;
		ranges.push({
			start: match.index,
			end: match.index + match[0].length,
			num,
			token: match[0],
		});
	}
	return ranges;
}

/** Extensions that are never UTF-8 text — always attach as a path reference. */
export const BINARY_EXT_RE =
	/\.(docx?|docm|xlsx?|xlsm|pptx?|ppsx?|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|apk|ipa|dmg|iso|pkg|exe|dll|dylib|so|a|o|obj|wasm|bin|dat|db|sqlite3?|sqlite-journal|class|pyc|pyo|node|ttf|otf|woff2?|eot|mp[34]|m4[avp]|mov|avi|mkv|webm|flv|wav|flac|aac|ogg|opus|psd|ai|sketch|fig|xd|icns|ico|heic|heif|nib|car|xcarchive|app|framework|bundle|key|numbers|pages|epub|mobi|cbz|cbr|chm|rtf|od[tsgp]|vsdx?|drawio|mpp|pub|one|msg|eml|pst|p12|pfx|der|crt|cer|pem|keystore|arrow|parquet|feather|orc|h5|hdf5|npy|npz|pkl|joblib|onnx|pb|tflite|ckpt|safetensors|gguf)$/i;

/** Filename/path extension says binary. Extensionless paths are NOT flagged —
 * plenty of real text files have no extension; content sniff decides those. */
export function isProbablyBinaryPath(pathOrName: string): boolean {
	return BINARY_EXT_RE.test(pathOrName);
}

const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

/** Content sniff: a NUL byte or undecodable UTF-8 in the sample means binary.
 * Keep the sample well above one code point so a truncated multi-byte char
 * at the edge can't false-positive. */
export function isBinaryBytes(sample: Uint8Array): boolean {
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] === 0) return true;
	}
	try {
		UTF8_FATAL.decode(sample);
		return false;
	} catch {
		return true;
	}
}

/** Basename of a POSIX path (trailing slashes tolerated). */
export function baseName(path: string): string {
	const trimmed = path.replace(/\/+$/, "");
	const idx = trimmed.lastIndexOf("/");
	return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
