/** Pure scheduling predicate for automatic omp update checks. */

const HOUR_MS = 60 * 60 * 1000;

/**
 * True when an automatic check is due: never checked, clock moved backwards,
 * or at least `intervalHours` elapsed since `lastCheckedAt` (all epoch ms).
 */
export function isCheckDue(lastCheckedAt: number | null, intervalHours: number, now: number): boolean {
	if (lastCheckedAt === null) return true;
	if (now < lastCheckedAt) return true;
	return now - lastCheckedAt >= intervalHours * HOUR_MS;
}
