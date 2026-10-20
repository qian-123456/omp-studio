/** User-bubble text with inline image/file markers rendered as clickable
 * `🖼️#N` / `📎#N` tokens. Shared by sent bubbles, in-turn steers and queued
 * bubbles so every user message looks identical. */
import { openPath } from "@tauri-apps/plugin-opener";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { PrivacyText } from "../privacy/SecretChip";
import { getImageTokenPalette } from "./Composer";
import { parseLeadingCommand } from "./slash/chip";
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
	// Leading `/skill:x` (or known command) → same token the composer shows.
	const lead = parseLeadingCommand(cleaned);
	if (lead) {
		const badge = (
			<span key="lead-cmd" className="mx-1.5 inline-block align-baseline first:ml-0">
				<CommandChipBadge chip={lead.chip} />
			</span>
		);
		// Mid-text chip: wire text carries a position marker (see chip.ts).
		if (lead.tail !== undefined) {
			return [
				...renderUserTextWithChipsBody(lead.rest, onOpen),
				badge,
				...renderUserTextWithChipsBody(lead.tail, onOpen),
			];
		}
		return [badge, ...renderUserTextWithChipsBody(lead.rest, onOpen)];
	}
	return renderUserTextWithChipsBody(cleaned, onOpen);
}

function renderUserTextWithChipsBody(
	cleaned: string,
	onOpen: (markerNum: number) => void,
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
		if (at > last) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last, at)} />);
		const num = Number.parseInt(m[1] ?? m[2] ?? m[3] ?? "1", 10) || 1;
		const palette = getImageTokenPalette(num);
		if (kind === "file") {
			const path = m[2]?.trim();
			parts.push(
				<button
					key={`file-${at}`}
					type="button"
					onClick={() => {
						if (path) {
							void openPath(path).catch((e: unknown) =>
								toast.error(`打开文件失败: ${errMsg(e)}`),
							);
						}
					}}
					title={path ? `打开文件 #${num}：${path}` : `文件 #${num}`}
					className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
					style={{ color: palette.hex }}
				>
					<span
						className="underline decoration-2 underline-offset-[3px]"
						style={{ color: palette.hex, textDecorationColor: palette.hex }}
					>
						{`📎#${num}`}
					</span>
				</button>,
			);
		} else {
			parts.push(
				<button
					key={`img-${at}`}
					type="button"
					onClick={() => onOpen(num)}
					title={`查看图片 #${num}`}
					className="mx-0.5 inline cursor-pointer align-baseline hover:opacity-80"
					style={{ color: palette.hex }}
				>
					<span
						className="underline decoration-2 underline-offset-[3px]"
						style={{ color: palette.hex, textDecorationColor: palette.hex }}
					>
						{`🖼️#${num}`}
					</span>
				</button>,
			);
		}
		last = at + len;
	}
	if (last < cleaned.length) parts.push(<PrivacyText key={`t-${last}`} text={cleaned.slice(last)} />);
	return parts;
}
