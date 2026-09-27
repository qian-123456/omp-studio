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
// the capsule thumb only renders while an element is actively scrolling (or
// while the pointer hovers/drags the scrollbar lane). Tag the scrolled element
// itself — ancestor selectors are unreliable against scrollbar pseudo-elements.
// `data-scroll-active` records intent so a mutation observer can restore the
// class whenever a React re-render rewrites `className` and strips it.
const scrollingEls = new Set<Element>();
const scrollIdleTimers = new Map<Element, number>();
window.addEventListener(
	"scroll",
	(e) => {
		const el = (e.target === document ? document.body : e.target) as Element;
		scrollingEls.add(el);
		el.setAttribute("data-scroll-active", "");
		el.classList.add("is-scrolling");
		const prev = scrollIdleTimers.get(el);
		if (prev !== undefined) window.clearTimeout(prev);
		scrollIdleTimers.set(
			el,
			window.setTimeout(() => {
				scrollingEls.delete(el);
				scrollIdleTimers.delete(el);
				el.removeAttribute("data-scroll-active");
				el.classList.remove("is-scrolling");
			}, 500),
		);
	},
	{ capture: true, passive: true },
);
// React re-renders on scroll (e.g. scroll-pill state) can reset `className`
// and drop `is-scrolling`; re-apply it while the element is marked active.
new MutationObserver((records) => {
	for (const rec of records) {
		const el = rec.target as Element;
		if (scrollingEls.has(el) && !el.classList.contains("is-scrolling")) {
			el.classList.add("is-scrolling");
		}
	}
}).observe(document.body, {
	subtree: true,
	attributes: true,
	attributeFilter: ["class"],
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
