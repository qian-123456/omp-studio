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
// so the flag must be a class on the scrolled element itself. React re-renders
// that reset `className` mid-scroll are re-covered by the very next scroll
// event in the same gesture, so no mutation observer is needed.
const scrollIdleTimers = new Map<Element, number>();
window.addEventListener(
	"scroll",
	(e) => {
		const el = (e.target === document ? document.body : e.target) as Element;
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
	},
	{ capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
