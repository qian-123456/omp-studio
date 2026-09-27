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
// toggle a body class while scrolling so the capsule thumb only renders during
// scrolling (or while hovering/dragging the scrollbar). No JS → no pill.
let scrollIdleTimer = 0;
window.addEventListener(
	"scroll",
	() => {
		document.body.classList.add("is-scrolling");
		clearTimeout(scrollIdleTimer);
		scrollIdleTimer = window.setTimeout(() => {
			document.body.classList.remove("is-scrolling");
		}, 500);
	},
	{ capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
