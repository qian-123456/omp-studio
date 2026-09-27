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
const scrollingEls = new Map<Element, number>();
window.addEventListener(
	"scroll",
	(e) => {
		const el = (e.target === document ? document.body : e.target) as Element;
		el.classList.add("is-scrolling");
		const prev = scrollingEls.get(el);
		if (prev !== undefined) window.clearTimeout(prev);
		scrollingEls.set(
			el,
			window.setTimeout(() => {
				el.classList.remove("is-scrolling");
				scrollingEls.delete(el);
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
