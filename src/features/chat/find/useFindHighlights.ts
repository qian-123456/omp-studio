import { useEffect, type RefObject } from "react";
import { useTurnNav } from "../../../stores/turnNav";
import { collectRanges, resolveAnchor } from "./findCore";
import { useThreadFind } from "./threadFindStore";

const ALL = "find-match";
const CURRENT = "find-current";

function clearHighlights(): void {
	if (typeof CSS === "undefined" || !CSS.highlights) return;
	CSS.highlights.delete(ALL);
	CSS.highlights.delete(CURRENT);
}

/**
 * Paints find matches with the CSS Custom Highlight API over the mounted DOM and
 * navigates to the current match. The transcript is virtualized, so a
 * MutationObserver re-runs the pass whenever rows mount/unmount; the current
 * match is identified by (item id, occurrence) in the *data*, then mapped to the
 * nth DOM occurrence inside the item's rendered anchor (`msg-<stepId>`, which is
 * `msg-steer-<itemId>` / `msg-text-<itemId>` for turn steps).
 */
export function useFindHighlights(
	scrollRef: RefObject<HTMLElement | null>,
	sessionId: string,
): void {
	useEffect(() => {
		if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
		const root = scrollRef.current;
		if (!root) return;
		let raf = 0;
		let revealed = -1;
		let retry = 0;

		const apply = () => {
			raf = 0;
			const st = useThreadFind.getState();
			if (!st.open || st.sessionId !== sessionId || !st.query) {
				clearHighlights();
				return;
			}
			CSS.highlights.set(ALL, new Highlight(...collectRanges(root, st.query)));
			const cur = st.index >= 0 ? st.matches[st.index] : undefined;
			const host = cur ? resolveAnchor(root, cur.itemId) : null;
			const ranges = host ? collectRanges(host, st.query) : [];
			const range = cur ? (ranges[cur.occurrence] ?? ranges[ranges.length - 1]) : undefined;
			if (!range) {
				CSS.highlights.delete(CURRENT);
				return;
			}
			CSS.highlights.set(CURRENT, new Highlight(range));
			if (revealed !== st.navNonce) {
				revealed = st.navNonce;
				const el = range.startContainer.parentElement;
				el?.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		};
		const schedule = () => {
			if (!raf) raf = requestAnimationFrame(apply);
		};

		const unsub = useThreadFind.subscribe((s, prev) => {
			if (s.navNonce !== prev.navNonce && s.index >= 0) {
				const m = s.matches[s.index];
				// Mount the (possibly virtualized-away) block; apply() then centers the text.
				if (m && !resolveAnchor(root, m.itemId)) {
					useTurnNav.getState().showTurn(sessionId, m.itemId);
				}
				retry = 0;
			}
			schedule();
		});
		const mo = new MutationObserver(schedule);
		mo.observe(root, { childList: true, subtree: true, characterData: true });
		// Scroll-driven remounts mutate the DOM, but a just-revealed block may need a few frames.
		const timer = window.setInterval(() => {
			const s = useThreadFind.getState();
			if (s.open && revealed !== s.navNonce && retry++ < 20) schedule();
		}, 100);
		schedule();
		return () => {
			unsub();
			mo.disconnect();
			window.clearInterval(timer);
			if (raf) cancelAnimationFrame(raf);
			clearHighlights();
		};
	}, [scrollRef, sessionId]);
}
