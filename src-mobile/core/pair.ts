/**
 * Pairing: omp's `/pair?code=` redeems a one-time code and answers 303 + Set-Cookie. Loading it in a
 * hidden same-origin iframe lets the browser store the HttpOnly cookie without navigating away.
 * Never retried: a code is single-use.
 */
import { api } from "./api";
import { reconnectEvents } from "./sse";
import { useConnection } from "./stores/connection";

/** Remove `?pair=<code>` from the address bar and return it. */
export function takePairCode(): string | null {
	try {
		const url = new URL(window.location.href);
		const code = url.searchParams.get("pair");
		if (!code) return null;
		url.searchParams.delete("pair");
		history.replaceState(history.state, "", url.pathname + url.search + url.hash);
		return code;
	} catch {
		return null;
	}
}

export function pairWithCode(code: string, timeoutMs = 8000): Promise<boolean> {
	return new Promise((resolve) => {
		if (!code) return resolve(false);
		const frame = document.createElement("iframe");
		frame.setAttribute("aria-hidden", "true");
		frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
		let done = false;
		const finish = (ok: boolean) => {
			if (done) return;
			done = true;
			setTimeout(() => frame.remove(), 0);
			if (ok) {
				useConnection.getState().setPhase("idle");
				reconnectEvents();
			}
			resolve(ok);
		};
		frame.onload = () => {
			// The first load can still be the redirect chain; probe with a real call.
			api("GET", "/sessions").then(
				() => finish(true),
				() => finish(false),
			);
		};
		frame.src = `/pair?code=${encodeURIComponent(code)}`;
		document.body.appendChild(frame);
		setTimeout(() => finish(false), timeoutMs);
	});
}
