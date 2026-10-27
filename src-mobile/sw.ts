/**
 * Service worker of the phone web app: web push display + notification click routing.
 * Self-contained script (NO imports and NO exports) so the build emits it as an unhashed
 * classic-compatible `/sw.js`. Types are declared locally because the project compiles with
 * the DOM lib, which cannot be combined with the webworker lib.
 * No fetch handler / caching: the app is always served live by the desktop.
 */

interface SwWaitable {
	waitUntil(p: Promise<unknown>): void;
}
interface SwClient {
	url: string;
	focus(): Promise<unknown>;
	navigate?(url: string): Promise<{ focus(): Promise<unknown> } | null>;
	postMessage(message: unknown): void;
}
interface SwNotification {
	close(): void;
	data?: { url?: string } | null;
}
interface SwScope {
	location: { origin: string };
	registration: { showNotification(title: string, options: { body: string; tag?: string; data: unknown }): Promise<void> };
	clients: {
		claim(): Promise<void>;
		matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<SwClient[]>;
		openWindow(url: string): Promise<unknown>;
	};
	skipWaiting(): Promise<void>;
	addEventListener(type: string, listener: (event: never) => void): void;
}

interface PushPayload {
	title?: string;
	body?: string;
	tag?: string;
	/** Hash route like `#/s/<id>` or `/s/<id>` (or a full same-origin URL). */
	url?: string;
	data?: { url?: string };
}

const sw = self as unknown as SwScope;

/** Resolve a payload url to an absolute same-origin URL of the app (`/#/s/<id>`). */
function resolveTarget(raw: string | undefined, origin: string): string {
	const root = `${origin}/`;
	if (!raw) return root;
	if (raw.startsWith("#")) return `${root}${raw}`;
	if (raw.startsWith("/")) return `${root}#${raw}`;
	try {
		const u = new URL(raw);
		return u.origin === origin ? u.href : root;
	} catch {
		return root;
	}
}

sw.addEventListener("install", () => {
	void sw.skipWaiting();
});

sw.addEventListener("activate", (event: SwWaitable) => {
	event.waitUntil(sw.clients.claim());
});

sw.addEventListener("push", (event: SwWaitable & { data: { json(): unknown; text(): string } | null }) => {
	let payload: PushPayload = {};
	try {
		payload = event.data ? (event.data.json() as PushPayload) : {};
	} catch {
		payload = { body: event.data ? event.data.text() : "" };
	}
	const url = payload.url ?? payload.data?.url;
	event.waitUntil(
		sw.registration.showNotification(payload.title || "OMP", {
			body: payload.body || "",
			tag: payload.tag,
			data: { url },
		}),
	);
});

sw.addEventListener("notificationclick", (event: SwWaitable & { notification: SwNotification }) => {
	event.notification.close();
	const target = resolveTarget(event.notification.data?.url, sw.location.origin);
	event.waitUntil(
		(async () => {
			const all = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
			const client = all.find((c) => c.url.startsWith(sw.location.origin));
			if (client) {
				try {
					const navigated = client.navigate ? await client.navigate(target) : null;
					await (navigated ?? client).focus();
					return;
				} catch {
					// navigate() can fail for uncontrolled clients: focus and ask the page to route.
					try {
						await client.focus();
						client.postMessage({ type: "omp-navigate", url: target });
						return;
					} catch {
						/* open a fresh window below */
					}
				}
			}
			await sw.clients.openWindow(target);
		})(),
	);
});
