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
// while the pointer hovers/drags the scrollbar lane). Scroll state lives in the
// `data-scroll-active` ATTRIBUTE (not a class): React re-renders rewrite
// `className` but preserve attributes, so the flag survives stream re-renders
// and the idle-timer cleanup cannot race itself.
const scrollIdleTimers = new Map<Element, number>();
window.addEventListener(
	"scroll",
	(e) => {
		const el = (e.target === document ? document.body : e.target) as Element;
		el.setAttribute("data-scroll-active", "");
		const prev = scrollIdleTimers.get(el);
		if (prev !== undefined) window.clearTimeout(prev);
		scrollIdleTimers.set(
			el,
			window.setTimeout(() => {
				scrollIdleTimers.delete(el);
				el.removeAttribute("data-scroll-active");
			}, 500),
		);
	},
	{ capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
