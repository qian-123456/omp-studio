/** User-bubble text with inline image/file markers rendered as clickable
 * `🖼️#N` / `📎#N` tokens. Shared by sent bubbles, in-turn steers and queued
 * bubbles so every user message looks identical. */
import { openPath } from "@tauri-apps/plugin-opener";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { PrivacyText } from "../privacy/SecretChip";
import { getImageTokenPalette } from "./Composer";
import { parseCommandToken } from "./slash/chip";
import { CommandChipBadge } from "./slash/CommandChip";

/** Image/file markers and annotation-header noise removed; plain prose left. */
export function stripImageMarkers(text: string): string {
	return text
		.replace(
			/\[\d+\]\s*\([^)]*?\.(?:png|jpe?g|gif|webp|svg|bmp)[^)]*\)\s*\n?>?\s*(?:\[图片:[^\]]+\])?/gi,
			"",
		)
		.replace(
			/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片(?::\s*[^\]]+)?\]|🖼️\s*#\d+|\[(?:File|文件)\s*#\d+(?::\s*[^\]]+)?\]|📎\s*#\d+/gu,
			"",
		)
		.trim();
}


const USER_MARKER_RE =
	/\[(?:Image|图片)\s*#(\d+)(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|🖼️\s*#(\d+)/gu;

/** File-attachment marker `[文件 #N: path]` / `[File #N: path]` / `📎#N`;
 * groups: 1=num 2=path, 3=num (emoji form). */
const USER_FILE_MARKER_RE =
	/\[(?:File|文件)\s*#(\d+)(?::\s*([^\]]+))?\]|📎\s*#(\d+)/gu;

/** User bubble text with image markers kept in place as clickable `#n`
 *  chips (Composer palette). Annotation-header noise is still stripped. */
export function renderUserTextWithChips(
	text: string,
	onOpen: (markerNum: number) => void,
): React.ReactNode[] {
	const cleaned = text
		.replace(
			/\[\d+\]\s*\([^)]*?\.(?:png|jpe?g|gif|webp|svg|bmp)[^)]*\)\s*\n?>?\s*(?:\[图片:[^\]]+\])?/gi,
			"",
		)
		.trim();
	// `/skill:x` (or known leading command) → same token the composer shows,
	// at the spot the user wrote it.
	const lead = parseCommandToken(cleaned);
	if (lead) {
		const badge = (
			<span key="lead-cmd" className="mx-1.5 inline-block align-baseline first:ml-0">
				<CommandChipBadge chip={lead.chip} />
			</span>
		);
		// Mid-text skill: text before, token, text after.
		if (lead.tail !== undefined) {
			return [
				...renderUserTextWithChipsBody(lead.rest, onOpen, "pre-"),
				badge,
				...renderUserTextWithChipsBody(lead.tail, onOpen, "post-"),
			];
		}
		return [badge, ...renderUserTextWithChipsBody(lead.rest, onOpen)];
	}
	return renderUserTextWithChipsBody(cleaned, onOpen);
}

function FilePlainToken({ num, hex }: { num: number; hex: string }) {
	const { t } = useT();
	return (
		<span
			title={t("chatView.chips.fileTitle", { num })}
			className="mx-0.5 inline align-baseline"
			style={{ color: hex }}
		>
			{`📎#${num}`}
		</span>
	);
}

function FileToken({ num, path, hex }: { num: number; path: string; hex: string }) {
	const { t } = useT();
	return (
		<button
			type="button"
			onClick={() => {
				void openPath(path).catch((e: unknown) =>
					toast.error(t("chatView.chips.openFileFailed", { error: errMsg(e) })),
				);
			}}
			title={t("chatView.chips.openFileWithPath", { num, path })}
			className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
			style={{ color: hex }}
		>
			<span
				className="underline decoration-2 underline-offset-[3px]"
				style={{ color: hex, textDecorationColor: hex }}
			>
				{`📎#${num}`}
			</span>
		</button>
	);
}

function ImageToken({ num, hex, onOpen }: { num: number; hex: string; onOpen: (markerNum: number) => void }) {
	const { t } = useT();
	return (
		<button
			type="button"
			onClick={() => onOpen(num)}
			title={t("chatView.chips.viewImageTitle", { num })}
			className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
			style={{ color: hex }}
		>
			<span
				className="underline decoration-2 underline-offset-[3px]"
				style={{ color: hex, textDecorationColor: hex }}
			>
				{`🖼️#${num}`}
			</span>
		</button>
	);
}

function renderUserTextWithChipsBody(
	cleaned: string,
	onOpen: (markerNum: number) => void,
	keyPrefix = "",
): React.ReactNode[] {
	const parts: React.ReactNode[] = [];
	// Merge image + file markers, ordered by position.
	const markers: Array<{ at: number; len: number; kind: "img" | "file"; m: RegExpMatchArray }> = [];
	for (const m of cleaned.matchAll(USER_MARKER_RE)) {
		markers.push({ at: m.index ?? 0, len: m[0].length, kind: "img", m });
	}
	for (const m of cleaned.matchAll(USER_FILE_MARKER_RE)) {
		markers.push({ at: m.index ?? 0, len: m[0].length, kind: "file", m });
	}
	markers.sort((a, b) => a.at - b.at);
	let last = 0;
	for (const { at, len, kind, m } of markers) {
		if (at < last) continue; // overlapping alternative — keep the earlier one
		if (at > last) parts.push(<PrivacyText key={`${keyPrefix}t-${last}`} text={cleaned.slice(last, at)} />);
		const num = Number.parseInt(m[1] ?? m[2] ?? m[3] ?? "1", 10) || 1;
		const palette = getImageTokenPalette(num);
		if (kind === "file") {
			const path = m[2]?.trim();
			if (!path) {
				// No path to open: a button would be dead, so show a plain token.
				parts.push(<FilePlainToken key={`${keyPrefix}file-${at}`} num={num} hex={palette.hex} />);
				last = at + len;
				continue;
			}
			parts.push(<FileToken key={`${keyPrefix}file-${at}`} num={num} path={path} hex={palette.hex} />);
		} else {
			parts.push(<ImageToken key={`${keyPrefix}img-${at}`} num={num} hex={palette.hex} onOpen={onOpen} />);
		}
		last = at + len;
	}
	if (last < cleaned.length) parts.push(<PrivacyText key={`${keyPrefix}t-${last}`} text={cleaned.slice(last)} />);
	return parts;
}
