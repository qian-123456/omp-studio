/** A pairing code is consumed only by an explicit POST; never infer success from an older cookie. */
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

export async function pairWithCode(code: string, timeoutMs = 8000): Promise<boolean> {
	if (!code) return false;
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), timeoutMs);
	try {
		const res = await fetch("/pair", {
			method: "POST", credentials: "same-origin", signal: ctl.signal,
			headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
		});
		if (res.status !== 204) return false;
		// Explicit successful redemption is the only transition out of terminal 401.
		useConnection.setState({ phase: "idle", error: null });
		reconnectEvents();
		return true;
	} catch { return false; }
	finally { clearTimeout(timer); }
}
