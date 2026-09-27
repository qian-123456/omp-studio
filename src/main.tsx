import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";
import { startSessionEvents, useSessions } from "./stores/sessions";

// Apply the persisted theme before first paint so there is no palette flash.
initTheme();

// Load the session index once and subscribe to catalog events at app start.
startSessionEvents()
	.then(() => useSessions.getState().load())
	.catch((err) => console.error("initial session load failed", err));

// macOS-style overlay scrollbars on the classic-scrollbars system setting:
// the capsule thumb renders only while an element is actively scrolling (or
// while the pointer hovers/drags the scrollbar lane). WebKit DOES repaint
// scrollbar pseudo-elements on class changes but NOT on attribute changes,
// so the flag must be a class on the scrolled element itself.
//
// Timing: `scroll` events keep coming during macOS momentum for a while after
// the gesture ends — that is real scrolling, the pill SHOULD stay up. `wheel`
// events fire from finger contact, so they get a shorter idle window (350ms)
// to approximate "gesture over" without waiting out the full momentum tail.
const scrollIdleTimers = new Map<Element, number>();
const markScrolling = (el: Element, idleMs: number) => {
	el.classList.add("is-scrolling");
	const prev = scrollIdleTimers.get(el);
	if (prev !== undefined) window.clearTimeout(prev);
	scrollIdleTimers.set(
		el,
		window.setTimeout(() => {
			scrollIdleTimers.delete(el);
			el.classList.remove("is-scrolling");
		}, idleMs),
	);
};
window.addEventListener(
	"scroll",
	(e) =>
		markScrolling(e.target === document ? document.body : (e.target as Element), 500),
	{ capture: true, passive: true },
);
window.addEventListener(
	"wheel",
	(e) => {
		let el = e.target as Element | null;
		while (el && el !== document.body) {
			const st = getComputedStyle(el);
			if (/(auto|scroll)/.test(st.overflowY + st.overflowX)) break;
			el = el.parentElement;
		}
		markScrolling(el ?? document.body, 350);
	},
	{ capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
