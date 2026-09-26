/**
 * Natural sort comparator for session labels (e.g. #1.2 before #1.10).
 * Compares dot-separated numerical segments; falls back to localeCompare for non-numeric parts.
 */
export function compareSessionLabels(a: string, b: string): number {
	if (a === b) return 0;

	// Strip leading '#' and whitespace
	const cleanA = a.replace(/^#/, "").trim();
	const cleanB = b.replace(/^#/, "").trim();

	const segsA = cleanA.split(".");
	const segsB = cleanB.split(".");
	const maxLen = Math.max(segsA.length, segsB.length);

	for (let i = 0; i < maxLen; i++) {
		const segA = segsA[i];
		const segB = segsB[i];

		if (segA === undefined) return -1;
		if (segB === undefined) return 1;

		const numA = Number(segA);
		const numB = Number(segB);

		const isNumA = !Number.isNaN(numA) && segA.trim() !== "";
		const isNumB = !Number.isNaN(numB) && segB.trim() !== "";

		if (isNumA && isNumB) {
			if (numA !== numB) {
				return numA - numB;
			}
		} else {
			const strCmp = segA.localeCompare(segB, undefined, { numeric: true });
			if (strCmp !== 0) {
				return strCmp;
			}
		}
	}

	return a.localeCompare(b, undefined, { numeric: true });
}
