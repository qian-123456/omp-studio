import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { tNow } from "./stores/language";
import { initTheme } from "./lib/theme";
import { startScrollPills } from "./lib/scrollPills";
import { installDraftAutoCleanup } from "./features/sessions/newSession";
import { startSessionEvents, useSessions } from "./stores/sessions";
import { suppressWebViewContextMenu } from "./lib/webviewContextMenu";

// Apply the persisted theme before first paint so there is no palette flash.
initTheme();

// Load the session index once and subscribe to catalog events at app start.
startSessionEvents()
	.then(() => useSessions.getState().load())
	.catch((err) => console.error("initial session load failed", err));
// Prune completely empty drafts when selection moves away from them.
installDraftAutoCleanup();
// Native scrollbars are hidden in CSS (classic always-on lane is ugly);
// these JS-drawn overlay pills replace them.
startScrollPills();
// Suppress the native WebView menu ("Reload" / "Inspect Element") except for
// links, images, and editable fields. Custom menus call preventDefault themselves.
document.addEventListener("contextmenu", suppressWebViewContextMenu);

interface RootErrorBoundaryState {
	error: Error | null;
}

class RootErrorBoundary extends React.Component<
	{ children: React.ReactNode },
	RootErrorBoundaryState
> {
	state: RootErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		console.error("RootErrorBoundary caught error:", error, info);
	}

	render() {
		if (this.state.error) {
			return (
				<div className="flex h-screen w-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-200">
					<div className="max-w-lg rounded-xl border border-red-900/60 bg-red-950/30 p-6 shadow-xl">
						<h2 className="text-base font-semibold text-red-300">{tNow("shell.appCrashTitle")}</h2>
						<p className="mt-2 text-xs text-neutral-400 font-mono break-all whitespace-pre-wrap">
							{this.state.error?.message || String(this.state.error)}
						</p>
						<button
							type="button"
							className="mt-4 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
							onClick={() => window.location.reload()}
						>
							{tNow("shell.reloadApp")}
						</button>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<RootErrorBoundary>
			<App />
		</RootErrorBoundary>
	</React.StrictMode>,
);
