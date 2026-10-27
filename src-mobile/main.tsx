import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initNav } from "./core/nav";
import { pairWithCode, takePairCode } from "./core/pair";
import { startEvents } from "./core/sse";
import { useSessions } from "./core/stores/sessions";
import { startDisplayPrefs } from "./features/settings/displayPrefs";
import "./styles/base.css";

/** Boot order matters: a `?pair=<code>` must be redeemed before the first authenticated call. */
async function boot() {
	const code = takePairCode();
	if (code) await pairWithCode(code);
	initNav();
	startEvents();
	startDisplayPrefs();
	void useSessions.getState().refresh().catch(() => {});
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

void boot();
