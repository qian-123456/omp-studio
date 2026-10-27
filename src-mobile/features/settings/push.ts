import { api } from "../../core/api";
import { nav } from "../../core/nav";

/** Why web push cannot be used in the current page, or `null` when it can. */
export type PushBlock = "insecure" | "no-service-worker" | "no-push-manager" | "no-notification" | "denied";

export interface PushEnv {
	isSecureContext: boolean;
	hasServiceWorker: boolean;
	hasPushManager: boolean;
	hasNotification: boolean;
	/** `Notification.permission`, or "default" when the API is missing. */
	permission: NotificationPermission;
	/** iPhone/iPad Safari (push there needs the page added to the Home Screen). */
	isIos: boolean;
	/** Running as a Home Screen app. */
	standalone: boolean;
}

export interface PushCapability {
	available: boolean;
	block: PushBlock | null;
	/** Plain-Chinese reason shown next to the disabled switch. */
	reason: string | null;
	/** Extra iOS hint (add to Home Screen) when relevant. */
	hint: string | null;
}

export function readPushEnv(): PushEnv {
	const w = window as unknown as { Notification?: { permission: NotificationPermission }; PushManager?: unknown };
	const ua = navigator.userAgent;
	const nav = navigator as Navigator & { standalone?: boolean };
	return {
		isSecureContext: window.isSecureContext === true,
		hasServiceWorker: "serviceWorker" in navigator,
		hasPushManager: typeof w.PushManager !== "undefined",
		hasNotification: typeof w.Notification !== "undefined",
		permission: w.Notification?.permission ?? "default",
		isIos: /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1),
		standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
	};
}

const IOS_HINT = "iPhone 需先用 Safari 的「添加到主屏幕」，再从主屏幕图标打开本页。";

/** Pure capability matrix: insecure context wins, then missing APIs, then a denied permission. */
export function pushCapability(env: PushEnv): PushCapability {
	const iosHint = env.isIos && !env.standalone ? IOS_HINT : null;
	if (!env.isSecureContext) return { available: false, block: "insecure", reason: "需要 https 连接", hint: iosHint };
	if (!env.hasServiceWorker) return { available: false, block: "no-service-worker", reason: "当前浏览器不支持后台服务", hint: iosHint };
	if (!env.hasPushManager || !env.hasNotification) {
		return {
			available: false,
			block: env.hasPushManager ? "no-notification" : "no-push-manager",
			reason: iosHint ? "当前页面不支持推送" : "当前浏览器不支持推送",
			hint: iosHint,
		};
	}
	if (env.permission === "denied") {
		return { available: false, block: "denied", reason: "通知权限已被拒绝，请在系统或浏览器设置中允许", hint: iosHint };
	}
	return { available: true, block: null, reason: null, hint: iosHint };
}

/** VAPID base64url public key → bytes for `pushManager.subscribe`. */
export function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const pad = "=".repeat((4 - (b64.length % 4)) % 4);
	const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** Accept `{publicKey}`, `{key}` or a bare string from `GET /push/public-key`. */
export function extractPublicKey(res: unknown): string {
	if (typeof res === "string" && res) return res;
	if (res && typeof res === "object") {
		const o = res as { publicKey?: unknown; key?: unknown };
		const k = o.publicKey ?? o.key;
		if (typeof k === "string" && k) return k;
	}
	throw new Error("服务器没有返回推送公钥");
}

export type ApiFn = <T>(method: string, path: string, body?: unknown) => Promise<T>;

/** Minimal slice of the browser APIs used by the subscribe flow (injectable for tests). */
export interface PushRuntime {
	requestPermission(): Promise<NotificationPermission>;
	/** Registers (idempotent) and resolves once the worker is active. */
	registration(): Promise<PushRegistrationLike>;
}

export interface PushRegistrationLike {
	pushManager: {
		getSubscription(): Promise<PushSubscriptionLike | null>;
		subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<PushSubscriptionLike>;
	};
}

export interface PushSubscriptionLike {
	endpoint: string;
	toJSON(): unknown;
	unsubscribe(): Promise<boolean>;
}

export const browserRuntime: PushRuntime = {
	requestPermission: () => Notification.requestPermission(),
	registration: async () => {
		await registerServiceWorker();
		return (await navigator.serviceWorker.ready) as unknown as PushRegistrationLike;
	},
};

/** Register `/sw.js` at root scope; also routes `omp-navigate` messages from notification clicks. */
let registering: Promise<ServiceWorkerRegistration> | null = null;
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
	registering ??= navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(async (reg) => {
		navigator.serviceWorker.addEventListener("message", (e) => {
			const d = e.data as { type?: string; url?: string } | null;
			if (d?.type !== "omp-navigate" || typeof d.url !== "string") return;
			const i = d.url.indexOf("#");
			if (i >= 0) nav.push(d.url.slice(i + 1));
		});
		return reg;
	});
	registering.catch(() => {
		registering = null;
	});
	return registering;
}

/** Is this browser currently subscribed? Never prompts. */
export async function currentSubscription(env: PushEnv = readPushEnv()): Promise<boolean> {
	if (!pushCapability({ ...env, permission: "default" }).available) return false;
	try {
		const reg = await navigator.serviceWorker.getRegistration("/");
		return !!(await reg?.pushManager.getSubscription());
	} catch {
		return false;
	}
}

/**
 * Enable push: ask permission, subscribe with the server's VAPID key, hand the subscription to the server.
 * Throws Error with a Chinese message when the user declines or the server rejects.
 */
export async function enablePush(rt: PushRuntime = browserRuntime, call: ApiFn = api): Promise<void> {
	const perm = await rt.requestPermission();
	if (perm !== "granted") throw new Error(perm === "denied" ? "通知权限被拒绝，请在系统设置中允许后重试" : "未授予通知权限");
	const key = extractPublicKey(await call<unknown>("GET", "/push/public-key"));
	const reg = await rt.registration();
	let sub = await reg.pushManager.getSubscription();
	if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
	try {
		await call("POST", "/push/subscribe", sub.toJSON());
	} catch (e) {
		// Keep browser and server in sync: a subscription the server does not know is useless.
		await sub.unsubscribe().catch(() => false);
		throw e;
	}
}

/** Disable push: tell the server first (best effort), then drop the browser subscription. */
export async function disablePush(rt: PushRuntime = browserRuntime, call: ApiFn = api): Promise<void> {
	const reg = await rt.registration();
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	try {
		await call("POST", "/push/unsubscribe", { endpoint: sub.endpoint });
	} finally {
		await sub.unsubscribe();
	}
}

export async function sendTestPush(call: ApiFn = api): Promise<void> {
	await call("POST", "/push/test", {});
}
