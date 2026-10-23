/** Where a store-backed region is in its first-load lifecycle. */
export type LoadState = "loading" | "error" | "ready";

/**
 * Derive a region's load state from a store's `hasLoaded` flag and last load
 * error. A failed first load reports "error" (never an endless skeleton);
 * once data has arrived, a later refresh failure keeps showing the data.
 */
export function deriveLoadState(hasLoaded: boolean, error: string | null): LoadState {
	if (hasLoaded) return "ready";
	return error ? "error" : "loading";
}
