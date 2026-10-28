import { api } from "./api";
import { events } from "./sse";
import { isUnauthorized } from "./stores/connection";

// Serialize transitions so a slow previous page cannot overwrite the current view.
let revision = 0;
let tail: Promise<unknown> = Promise.resolve();

/** Visible chat ownership, independent of transcript/snapshot polling. */
export function startViewingPresence(sessionId: string): () => void {
	let active = true;
	const publish = (visible = active && !document.hidden) => {
		const mine = ++revision;
		tail = tail.catch(() => {}).then(async () => {
			if (mine !== revision || isUnauthorized()) return;
			await api("POST", "/presence", { sessionId: visible ? sessionId : null, visible }, { timeoutMs: 5000 });
		}).catch(() => {});
	};
	const onVisibility = () => publish();
	const offHello = events.on("hello", () => publish());
	document.addEventListener("visibilitychange", onVisibility);
	const timer = setInterval(() => { if (!document.hidden) publish(); }, 15_000);
	publish();
	return () => {
		active = false;
		clearInterval(timer);
		offHello();
		document.removeEventListener("visibilitychange", onVisibility);
		publish(false);
	};
}
