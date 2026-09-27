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
// Wheel events cover mouse/trackpad scrolls even where a scroll event is
// swallowed by React; pointermove into the scrollbar lane covers drag.
const scrollIdleTimers = new Map<Element, number>();
const markScrolling = (el: Element) => {
	el.classList.add("is-scrolling");
	const prev = scrollIdleTimers.get(el);
	if (prev !== undefined) window.clearTimeout(prev);
	scrollIdleTimers.set(
		el,
		window.setTimeout(() => {
			scrollIdleTimers.delete(el);
			el.classList.remove("is-scrolling");
		}, 600),
	);
};
window.addEventListener(
	"scroll",
	(e) => markScrolling(e.target === document ? document.body : (e.target as Element)),
	{ capture: true, passive: true },
);
// Wheel scroll: mark the element under the pointer (closest scrollable).
window.addEventListener(
	"wheel",
	(e) => {
		let el = e.target as Element | null;
		while (el && el !== document.body) {
			const st = getComputedStyle(el);
			if (/(auto|scroll)/.test(st.overflowY + st.overflowX)) break;
			el = el.parentElement;
		}
		markScrolling(el ?? document.body);
	},
	{ capture: true, passive: true },
);
// Pointer entering/dragging the scrollbar lane (right ~14px of a scrollable el).
window.addEventListener(
	"pointermove",
	(e) => {
		const t = e.target as Element;
		const scroller = t.closest?.("*[style*='overflow'], .overflow-y-auto, .overflow-x-auto, .overflow-auto, .overflow-scroll, .overflow-y-scroll, .overflow-x-scroll");
		if (!scroller) return;
		const r = scroller.getBoundingClientRect();
		if (e.clientX >= r.right - 14 || e.clientY >= r.bottom - 14) markScrolling(scroller);
	},
	{ capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
