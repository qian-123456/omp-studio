import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";
import { startScrollPills } from "./lib/scrollPills";
import { startSessionEvents, useSessions } from "./stores/sessions";

// Apply the persisted theme before first paint so there is no palette flash.
initTheme();

// Load the session index once and subscribe to catalog events at app start.
startSessionEvents()
	.then(() => useSessions.getState().load())
	.catch((err) => console.error("initial session load failed", err));
// Native scrollbars are hidden in CSS (classic always-on lane is ugly);
// these JS-drawn overlay pills replace them.
startScrollPills();


ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
