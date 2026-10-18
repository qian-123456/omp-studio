import { describe, expect, it } from "vitest";
import {
	FOLLOW_SETTLE_MS,
	NEAR_BOTTOM_PX,
	OPEN_DEADLINE_MS,
	detach,
	initialFollowScroll,
	onScrollPosition,
	onWroteBottom,
	shouldAnchorTurnTop,
	shouldCompensateResize,
	shouldFollow,
} from "./followScroll";

const T0 = 1_000_000;
/** Far from bottom: session open → content collapsed → clamp event fires a
 *  frame late, after the rehydrated transcript is already committed. */
const FAR = 5 * NEAR_BOTTOM_PX;
const AT_BOTTOM = 0;

describe("open session lands at bottom", () => {
	it("stale clamp scroll event during opening cannot detach", () => {
		let st = initialFollowScroll(T0);
		// items cleared → scrollTop clamped to 0 → queued scroll event fires
		// next frame when hydrated content already made scrollHeight tall.
		const stale = onScrollPosition(st, FAR, T0 + 16);
		expect(stale.trusted).toBe(false);
		expect(shouldFollow(stale.state)).toBe(true);
		// rAF stick reaches the bottom.
		st = onWroteBottom(stale.state, T0 + 20);
		expect(st.phase).toBe("following");
	});

	it("keeps following when hydration is slower than one frame", () => {
		let st = initialFollowScroll(T0);
		for (const dt of [50, 300, 900]) {
			const r = onScrollPosition(st, FAR, T0 + dt);
			expect(shouldFollow(r.state)).toBe(true);
			st = r.state;
		}
		st = onWroteBottom(st, T0 + 1000);
		expect(shouldFollow(st)).toBe(true);
	});

	it("late height growth before the first stick (images/markdown measured post-hydration) still bottoms out", () => {
		let st = initialFollowScroll(T0);
		// Virtualizer rows mount with estimateSize, then measureElement rewrites
		// scrollTop / clamps while the machine is still opening — every event
		// inside the deadline is involuntary and follow is kept.
		for (const dt of [40, 120, 220]) {
			const r = onScrollPosition(st, FAR, T0 + dt);
			expect(r.trusted).toBe(false);
			st = r.state;
		}
		st = onWroteBottom(st, T0 + 230); // RO-triggered stick
		expect(shouldFollow(st)).toBe(true);
		// A straggler event inside the settle window is still ignored.
		expect(onScrollPosition(st, FAR, T0 + 230 + FOLLOW_SETTLE_MS - 1).trusted).toBe(false);
	});

	it("open deadline eventually re-trusts scroll events when nothing was written", () => {
		const st = initialFollowScroll(T0);
		const r = onScrollPosition(st, FAR, T0 + OPEN_DEADLINE_MS + 1);
		expect(r.trusted).toBe(true);
		expect(shouldFollow(r.state)).toBe(false);
	});
});

describe("user scroll up stops following", () => {
	it("trusted far-from-bottom scroll after settle detaches", () => {
		let st = onWroteBottom(initialFollowScroll(T0), T0);
		const r = onScrollPosition(st, FAR, T0 + FOLLOW_SETTLE_MS + 50);
		expect(r.trusted).toBe(true);
		expect(shouldFollow(r.state)).toBe(false);
		// ...and stays detached while further growth happens.
		expect(shouldFollow(onWroteBottom(r.state, T0 + 999))).toBe(false);
	});

	it("scrollbar drags stay responsive: following does not re-arm suppression on later writes", () => {
		let st = onWroteBottom(initialFollowScroll(T0), T0);
		st = onWroteBottom(st, T0 + 500); // steady-state write mid-stream
		const drag = onScrollPosition(st, FAR, T0 + 520);
		expect(drag.trusted).toBe(true);
		expect(shouldFollow(drag.state)).toBe(false);
	});

	it("upward gesture detaches immediately, even mid-opening", () => {
		const st = detach(initialFollowScroll(T0));
		expect(shouldFollow(st)).toBe(false);
	});

	it("scrolling back to the bottom re-arms following (scroll pill)", () => {
		let st = detach(onWroteBottom(initialFollowScroll(T0), T0));
		st = onScrollPosition(st, FAR, T0 + FOLLOW_SETTLE_MS + 10).state;
		expect(st.phase).toBe("free");
		const landed = onScrollPosition(st, AT_BOTTOM, T0 + FOLLOW_SETTLE_MS + 400);
		expect(landed.state.phase).toBe("following");
	});

	it("scrolling up inside the near-bottom band must not re-arm following", () => {
		let st = detach(onWroteBottom(initialFollowScroll(T0), T0));
		const t = T0 + FOLLOW_SETTLE_MS + 10;
		// Wheel-up detached; the first scroll events still read dist < 120.
		st = onScrollPosition(st, 30, t, true).state;
		expect(shouldFollow(st)).toBe(false);
		st = onScrollPosition(st, 90, t + 16, true).state;
		expect(shouldFollow(st)).toBe(false);
		// Moving back down into the band re-arms.
		st = onScrollPosition(st, 40, t + 32, false).state;
		expect(shouldFollow(st)).toBe(true);
	});

	it("a growth-driven dist increase (scrollTop not lowered) still re-arms near bottom", () => {
		let st = detach(onWroteBottom(initialFollowScroll(T0), T0));
		const t = T0 + FOLLOW_SETTLE_MS + 10;
		st = onScrollPosition(st, 100, t, false).state;
		expect(shouldFollow(st)).toBe(true);
	});

	it("a far-from-bottom reading with no user input behind it never detaches a pinned stream", () => {
		let st = onWroteBottom(initialFollowScroll(T0), T0);
		const t = T0 + FOLLOW_SETTLE_MS + 10;
		// Virtualizer measurement bump / late content growth: dist is huge, nobody scrolled.
		const r = onScrollPosition(st, FAR, t, false, false);
		expect(r.trusted).toBe(false);
		expect(shouldFollow(r.state)).toBe(true);
		// The same reading while the user is scrolling does detach.
		st = onScrollPosition(st, FAR, t + 10, false, true).state;
		expect(shouldFollow(st)).toBe(false);
	});
});

describe("jump to message is respected", () => {
	it("detach() stops follow from fighting the smooth scroll mid-flight", () => {
		let st = onWroteBottom(initialFollowScroll(T0), T0);
		st = detach(st); // scrollRequest / revealTurn → scrollToIndex smooth
		const mid = onScrollPosition(st, FAR, T0 + 30);
		expect(shouldFollow(mid.state)).toBe(false);
		const landed = onScrollPosition(mid.state, AT_BOTTOM, T0 + 400);
		expect(landed.state.phase).toBe("following");
	});
});

describe("resize scroll compensation", () => {
	const VIEWPORT_TOP = 400;

	it("re-measure entirely above the fold compensates while scrolling backward", () => {
		// Visualize iframe above the viewport grows 240px → real height after
		// remount. The library default returned false here during backward
		// scroll, so visible content shifted.
		const above = { start: 100, end: 300 };
		expect(shouldCompensateResize(above, VIEWPORT_TOP, false)).toBe(true);
	});

	it("re-measure spanning the fold does not compensate (streaming turn growing)", () => {
		const spanning = { start: 300, end: 700 };
		expect(shouldCompensateResize(spanning, VIEWPORT_TOP, false)).toBe(false);
	});

	it("first measure with the block top above the fold compensates", () => {
		const estimated = { start: 300, end: 540 };
		expect(shouldCompensateResize(estimated, VIEWPORT_TOP, true)).toBe(true);
	});

	it("never compensates while following: the bottom pin owns the position", () => {
		const above = { start: 100, end: 300 };
		expect(shouldCompensateResize(above, VIEWPORT_TOP, false, true)).toBe(false);
		expect(shouldCompensateResize({ start: 300, end: 540 }, VIEWPORT_TOP, true, true)).toBe(false);
	});

	it("item at or below the viewport top never compensates", () => {
		const atTop = { start: 400, end: 600 };
		const below = { start: 800, end: 900 };
		for (const item of [atTop, below]) {
			expect(shouldCompensateResize(item, VIEWPORT_TOP, true)).toBe(false);
			expect(shouldCompensateResize(item, VIEWPORT_TOP, false)).toBe(false);
		}
	});
});

describe("shouldAnchorTurnTop", () => {
	const base = {
		armed: true,
		streaming: false,
		following: true,
		startKey: "turn-a:x:1",
		nowKey: "turn-b:y:2",
		targetTop: 400,
		maxTop: 900,
	};
	it("anchors once the transcript has committed a new turn", () => {
		expect(shouldAnchorTurnTop(base)).toBe(true);
	});
	it("waits while streaming or before the transcript catches up", () => {
		expect(shouldAnchorTurnTop({ ...base, streaming: true })).toBe(false);
		expect(shouldAnchorTurnTop({ ...base, nowKey: base.startKey })).toBe(false);
		expect(shouldAnchorTurnTop({ ...base, nowKey: null })).toBe(false);
	});
	it("never yanks a detached or unarmed viewport", () => {
		expect(shouldAnchorTurnTop({ ...base, following: false })).toBe(false);
		expect(shouldAnchorTurnTop({ ...base, armed: false })).toBe(false);
	});
	it("skips when the turn already fits (target at or past the bottom)", () => {
		expect(shouldAnchorTurnTop({ ...base, targetTop: 900 })).toBe(false);
		expect(shouldAnchorTurnTop({ ...base, targetTop: null })).toBe(false);
	});
});
