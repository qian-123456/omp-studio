import { describe, expect, it, vi } from "vitest";
import {
	disablePush,
	enablePush,
	extractPublicKey,
	pushCapability,
	urlBase64ToBytes,
	type PushEnv,
	type PushRuntime,
	type PushSubscriptionLike,
} from "./push";

const OK: PushEnv = {
	isSecureContext: true,
	hasServiceWorker: true,
	hasPushManager: true,
	hasNotification: true,
	permission: "default",
	isIos: false,
	standalone: false,
};

describe("pushCapability", () => {
	it("is available in a secure context with all APIs", () => {
		expect(pushCapability(OK)).toMatchObject({ available: true, block: null, reason: null, hint: null });
	});
	it("requires https first, even when other APIs are missing", () => {
		const c = pushCapability({ ...OK, isSecureContext: false, hasPushManager: false });
		expect(c).toMatchObject({ available: false, block: "insecure", reason: "需要 https 连接" });
	});
	it("reports missing service worker / PushManager / Notification separately", () => {
		expect(pushCapability({ ...OK, hasServiceWorker: false }).block).toBe("no-service-worker");
		expect(pushCapability({ ...OK, hasPushManager: false }).block).toBe("no-push-manager");
		expect(pushCapability({ ...OK, hasNotification: false }).block).toBe("no-notification");
	});
	it("explains a denied permission", () => {
		const c = pushCapability({ ...OK, permission: "denied" });
		expect(c.available).toBe(false);
		expect(c.block).toBe("denied");
	});
	it("adds the Home Screen hint on iOS Safari tabs only", () => {
		expect(pushCapability({ ...OK, isIos: true, isSecureContext: false }).hint).toContain("添加到主屏幕");
		expect(pushCapability({ ...OK, isIos: true, hasPushManager: false }).hint).toContain("主屏幕");
		expect(pushCapability({ ...OK, isIos: true, standalone: true }).hint).toBeNull();
	});
});

describe("VAPID key helpers", () => {
	it("decodes base64url without padding", () => {
		expect(Array.from(urlBase64ToBytes("AQID"))).toEqual([1, 2, 3]);
		expect(Array.from(urlBase64ToBytes("-_8"))).toEqual([251, 255]);
	});
	it("extracts the key from several response shapes", () => {
		expect(extractPublicKey({ publicKey: "k1" })).toBe("k1");
		expect(extractPublicKey({ key: "k2" })).toBe("k2");
		expect(extractPublicKey("k3")).toBe("k3");
		expect(() => extractPublicKey({})).toThrow("公钥");
	});
});

function fakeSub(endpoint = "https://push.example/1"): PushSubscriptionLike & { unsubscribe: ReturnType<typeof vi.fn> } {
	return {
		endpoint,
		toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
		unsubscribe: vi.fn(async () => true),
	};
}

function runtime(existing: PushSubscriptionLike | null, permission: NotificationPermission = "granted") {
	const sub = fakeSub();
	const subscribe = vi.fn(async (_o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }) => sub);
	const rt: PushRuntime = {
		requestPermission: vi.fn(async () => permission),
		registration: async () => ({ pushManager: { getSubscription: async () => existing, subscribe } }),
	};
	return { rt, sub, subscribe };
}

describe("enablePush", () => {
	it("asks permission, subscribes with the VAPID key and posts the subscription", async () => {
		const { rt, sub, subscribe } = runtime(null);
		const call = vi.fn(async (_method: string, path: string) => (path === "/push/public-key" ? { publicKey: "AQID" } : { ok: true }));
		await enablePush(rt, call as never);
		expect(subscribe).toHaveBeenCalledTimes(1);
		const opts = subscribe.mock.calls[0]![0];
		expect(opts.userVisibleOnly).toBe(true);
		expect(Array.from(opts.applicationServerKey)).toEqual([1, 2, 3]);
		expect(call).toHaveBeenCalledWith("POST", "/push/subscribe", sub.toJSON());
	});
	it("reuses an existing browser subscription", async () => {
		const existing = fakeSub("https://push.example/old");
		const { rt, subscribe } = runtime(existing);
		const call = vi.fn(async () => ({ publicKey: "AQID" }));
		await enablePush(rt, call as never);
		expect(subscribe).not.toHaveBeenCalled();
		expect(call).toHaveBeenLastCalledWith("POST", "/push/subscribe", existing.toJSON());
	});
	it("does not subscribe or call the server when permission is denied", async () => {
		const { rt, subscribe } = runtime(null, "denied");
		const call = vi.fn();
		await expect(enablePush(rt, call as never)).rejects.toThrow("拒绝");
		expect(subscribe).not.toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
	});
	it("rolls the browser subscription back when the server rejects it", async () => {
		const { rt, sub } = runtime(null);
		const call = vi.fn(async (_m: string, path: string) => {
			if (path === "/push/public-key") return { publicKey: "AQID" };
			throw new Error("boom");
		});
		await expect(enablePush(rt, call as never)).rejects.toThrow("boom");
		expect(sub.unsubscribe).toHaveBeenCalled();
	});
});

describe("disablePush", () => {
	it("notifies the server then unsubscribes the browser", async () => {
		const existing = fakeSub();
		const { rt } = runtime(existing);
		const call = vi.fn(async () => ({}));
		await disablePush(rt, call as never);
		expect(call).toHaveBeenCalledWith("POST", "/push/unsubscribe", { endpoint: existing.endpoint });
		expect(existing.unsubscribe).toHaveBeenCalled();
	});
	it("still drops the browser subscription when the server call fails", async () => {
		const existing = fakeSub();
		const { rt } = runtime(existing);
		const call = vi.fn(async () => {
			throw new Error("offline");
		});
		await expect(disablePush(rt, call as never)).rejects.toThrow("offline");
		expect(existing.unsubscribe).toHaveBeenCalled();
	});
	it("is a no-op without a subscription", async () => {
		const { rt } = runtime(null);
		const call = vi.fn();
		await disablePush(rt, call as never);
		expect(call).not.toHaveBeenCalled();
	});
});
