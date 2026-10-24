import { tNow } from "../../stores/language";

/** True for hosts where plain HTTP is normal: loopback, LAN, link-local, `.local`. */
function isLocalOrPrivateHost(rawHost: string): boolean {
	const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host === "local" || host.endsWith(".local")) return true;
	const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
	if (m) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		return (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		);
	}
	if (host.includes(":")) {
		return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host);
	}
	return false;
}

/**
 * Non-blocking advice for a Base URL. Returns a Chinese warning when the URL
 * uses plain http:// against a public host, otherwise null. Never blocks saving.
 */
export function insecureHttpWarning(baseUrl: string): string | null {
	let url: URL;
	try {
		url = new URL(baseUrl.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:") return null;
	if (isLocalOrPrivateHost(url.hostname)) return null;
	return tNow("providers.httpWarning");
}
