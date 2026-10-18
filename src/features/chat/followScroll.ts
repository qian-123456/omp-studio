/** Follow-bottom scroll policy for the message stream, extracted as a pure
 * state machine so the open/hydrate/stream decisions are unit-testable.
 *
 * Problem this solves: browsers deliver `scroll` events asynchronously — a
 * scrollTop *clamp* caused by content collapsing (clearing the transcript
 * while a session reloads) fires a scroll event one frame later, when the
 * freshly hydrated content may already be committed and `scrollHeight` tall
 * again. Reading `dist = scrollHeight - scrollTop - clientHeight` at dispatch
 * time then looks like "user scrolled to the top" and permanently detaches
 * follow-bottom — which is exactly why reopening a session used to land on
 * the first message.
 *
 * Model: three phases.
 * - `opening`   — the session view just mounted or the session id changed;
 *   scroll events are untrusted (stale clamps, virtualizer measurement
 *   adjustments while estimates get replaced) until the first stick-to-bottom
 *   write lands, the open deadline passes, or the user scrolls up.
 * - `following` — pinned to bottom. Scroll events are trusted again as soon
 *   as the settle window after the first stick elapses: trusted events keep
 *   scrollbar drags responsive during streaming, and remeasure/clamp events
 *   can't produce a far-from-bottom reading while content only grows (the
 *   virtualizer preserves the viewport by bumping scrollTop).
 * - `free`      — detached. A trusted event landing near bottom re-arms
 *   following (covers the scroll-to-bottom pill's smooth scroll finishing).
 *
 * Upward user gestures (wheel up, PageUp/arrow keys, touch drags) detach
 * immediately regardless of phase — the component calls `detach` for them.
 * Explicit programmatic jumps (`scrollToIndex`, reveal) call `detach` too, so
 * their smooth scroll isn't fought.
 */

export type ScrollPhase = "opening" | "following" | "free";

export interface FollowScrollState {
	phase: ScrollPhase;
	/** Epoch ms until which scroll events are treated as involuntary. */
	suppressUntil: number;
}

/** ms of scroll-event suppression after the first stick-to-bottom write, so
 *  in-flight stale clamp events can't detach the pin. */
export const FOLLOW_SETTLE_MS = 250;
/** Fallback lifetime of the opening phase when no bottom write ever happens
 *  (empty/failed transcript) — after this, scroll events become trusted. */
export const OPEN_DEADLINE_MS = 1500;
/** Viewport distance-from-bottom (px) at which the stream counts as pinned. */
export const NEAR_BOTTOM_PX = 120;

/** State for a (re)opened session, before any stale scroll event from the
 *  previous content can be processed. `now` arms the open deadline. */
export function initialFollowScroll(now: number): FollowScrollState {
	return { phase: "opening", suppressUntil: now + OPEN_DEADLINE_MS };
}

/** True while new content or height growth must keep the viewport at bottom. */
export const shouldFollow = (st: FollowScrollState): boolean =>
	st.phase !== "free";

/** Detach following: a real user scroll away from bottom, an upward scroll
 *  gesture, or an explicit programmatic jump (jump-to-message / reveal turn /
 *  search hit) whose smooth scroll must not be snapped back. */
export function detach(st: FollowScrollState): FollowScrollState {
	return st.phase === "free" ? st : { phase: "free", suppressUntil: 0 };
}

/** A stick-to-bottom write just ran (`el.scrollTop = el.scrollHeight`). The
 *  first write ends `opening` and arms one settle window covering the stale
 *  events still in flight; steady-state writes while already `following`
 *  don't extend suppression, so scrollbar drags stay responsive mid-stream. */
export function onWroteBottom(
	st: FollowScrollState,
	now: number,
): FollowScrollState {
	return st.phase === "opening"
		? { phase: "following", suppressUntil: now + FOLLOW_SETTLE_MS }
		: st;
}

/**
 * A scroll event fired. `dist` = scrollHeight - scrollTop - clientHeight,
 * `movedUp` = scrollTop decreased since the previous scroll event (a real
 * move toward the top; content growth raises `dist` without lowering
 * scrollTop, so it never counts), `userActive` = a wheel/key/touch/pointer
 * input happened recently, `now` in ms. `trusted` is false while the event
 * counts as involuntary (opening / post-write settle, or a pinned stream
 * seeing a far-from-bottom reading with no user input behind it — measurement
 * adjustments and late content growth look like that) — the caller must not
 * let it update the near-bottom pill or detach. Trusted events transition
 * `following` ⇄ `free` by the 120px threshold, except that a detached stream
 * stays `free` while the user is moving up: otherwise the first 120px of an
 * upward scroll re-arms following and the next content growth snaps the
 * viewport back down.
 */
export function onScrollPosition(
	st: FollowScrollState,
	dist: number,
	now: number,
	movedUp = false,
	userActive = true,
): { state: FollowScrollState; trusted: boolean } {
	if (now < st.suppressUntil) return { state: st, trusted: false };
	if (st.phase === "following" && dist >= NEAR_BOTTOM_PX && !userActive) {
		return { state: st, trusted: false };
	}
	const nearBottom = dist < NEAR_BOTTOM_PX && !(st.phase === "free" && movedUp);
	return {
		state: {
			phase: nearBottom ? "following" : "free",
			suppressUntil: 0,
		},
		trusted: true,
	};
}

/** How long after the last wheel/key/touch/pointer input a scroll counts as user-driven. */
export const USER_INPUT_WINDOW_MS = 400;

/**
 * Whether a row whose measured size just changed should shift `scrollTop` so
 * visible content stays put. Same rules as the TanStack default, minus its
 * scroll-direction clause: the default skips re-measurements during a
 * backward (upward) scroll, which leaves an above-fold resize uncompensated
 * and makes the visible content jump. Here an above-fold resize is always
 * compensated, whatever the direction.
 *
 * - first measurement: compensate when the estimated block started above
 *   the fold (`start < viewportTop`).
 * - re-measurement: compensate only when the item sits entirely above the
 *   fold (`end <= viewportTop`). An item spanning the fold, such as the
 *   latest turn growing while streaming, must not be shifted; that is the
 *   TanStack #1218 drag-down bug.
 */
export function shouldCompensateResize(
	item: { start: number; end: number },
	viewportTop: number,
	firstMeasure: boolean,
	following = false,
): boolean {
	// A pinned stream re-pins to the bottom after every size change; shifting
	// scrollTop from the virtualizer's cached (stale-after-pin) offset on top
	// of that fights the pin and can strand the viewport mid-answer.
	if (following) return false;
	return firstMeasure ? item.start < viewportTop : item.end <= viewportTop;
}

/**
 * Final-answer landing. While a turn streams the viewport pins to the bottom;
 * when the turn commits, the answer would sit under that pin with the user's
 * message long scrolled away and the answer's start below the fold. Instead the
 * view re-anchors on the turn's start — the user message as high as possible —
 * but only when that actually moves the view (a turn shorter than the viewport
 * is already fully visible at the bottom) and only if the user was still
 * following the stream (scrolling away to read must not be yanked).
 *
 * `startKey` is the latest committed turn's identity when streaming began,
 * `nowKey` the identity now; they differ once the transcript has caught up.
 */
export function shouldAnchorTurnTop(i: {
	armed: boolean;
	streaming: boolean;
	following: boolean;
	startKey: string | null;
	nowKey: string | null;
	/** Scroll offset of the turn's start, null when unknown. */
	targetTop: number | null;
	/** Largest reachable scrollTop (scrollHeight - clientHeight). */
	maxTop: number;
}): boolean {
	if (!i.armed || i.streaming || !i.following) return false;
	if (i.nowKey === null || i.nowKey === i.startKey) return false;
	return i.targetTop !== null && i.targetTop < i.maxTop - 1;
}
