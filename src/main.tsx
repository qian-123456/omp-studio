import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { startSessionEvents, useSessions } from "./stores/sessions";

// Load the session index once and subscribe to catalog events at app start.
startSessionEvents()
	.then(() => useSessions.getState().load())
	.catch((err) => console.error("initial session load failed", err));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
