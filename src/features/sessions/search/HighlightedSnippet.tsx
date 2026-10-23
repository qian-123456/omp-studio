import type { SearchSegment } from "../../../lib/contracts";

/**
 * Snippet with the matched tokens highlighted. Ellipses for a snippet cut
 * mid-message are rendered here (segments never contain them).
 */
export function HighlightedSnippet({
	segments,
	truncatedStart,
	truncatedEnd,
}: {
	segments: SearchSegment[];
	truncatedStart: boolean;
	truncatedEnd: boolean;
}) {
	return (
		<span className="break-words">
			{truncatedStart && "…"}
			{segments.map((seg, i) =>
				seg.hit ? (
					<mark key={i} className="rounded-sm bg-amber-400/25 px-px text-amber-200">
						{seg.text}
					</mark>
				) : (
					<span key={i}>{seg.text}</span>
				),
			)}
			{truncatedEnd && "…"}
		</span>
	);
}
