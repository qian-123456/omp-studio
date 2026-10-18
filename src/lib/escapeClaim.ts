/**
 * "This Esc was consumed" signal, kept dependency-free so any component or
 * hook can import it without pulling stores/components into its graph.
 *
 * `installEscapeGuard` (nativeShortcuts.ts) cancels the default action of
 * every Esc keydown, so `defaultPrevented` no longer tells whether a surface
 * handled the key. Surfaces that consume Esc call `claimEscape`; global
 * fallbacks (abort the running turn, leave a full-page view) yield when
 * `isEscapeClaimed` is true.
 */

const claimedEscapes = new WeakSet<Event>();

type ClaimableEvent = Pick<Event, "preventDefault"> & { nativeEvent?: Event };

/**
 * Mark an Esc keydown as consumed (closed a layer, cancelled an edit,
 * dismissed a menu) and cancel its default action. Accepts React synthetic
 * events: the claim is recorded on the underlying native event, which is what
 * window-level listeners receive.
 */
export function claimEscape(e: ClaimableEvent): void {
	claimedEscapes.add(e.nativeEvent ?? (e as Event));
	e.preventDefault();
}

export function isEscapeClaimed(e: Event): boolean {
	return claimedEscapes.has(e);
}
