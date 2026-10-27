// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;

interface FakeClient {
	url: string;
	focus: ReturnType<typeof vi.fn>;
	navigate: ReturnType<typeof vi.fn>;
	postMessage: ReturnType<typeof vi.fn>;
}

async function loadSw(clients: FakeClient[]) {
	const handlers: Record<string, Handler> = {};
	const shown: Array<{ title: string; options: { body: string; data: { url?: string } } }> = [];
	const openWindow = vi.fn(async () => null);
	const fakeSelf = {
		location: { origin: "https://phone.example" },
		registration: { showNotification: vi.fn(async (title: string, options: never) => void shown.push({ title, options })) },
		clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => clients), openWindow },
		skipWaiting: vi.fn(async () => {}),
		addEventListener: (type: string, fn: Handler) => {
			handlers[type] = fn;
		},
	};
	vi.stubGlobal("self", fakeSelf);
	vi.resetModules();
	await import("../../sw");
	return { handlers, shown, openWindow };
}

const waitable = () => {
	const ps: Promise<unknown>[] = [];
	return { waitUntil: (p: Promise<unknown>) => void ps.push(p), done: () => Promise.all(ps) };
};

describe("service worker", () => {
	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	it("shows a push notification carrying the target url", async () => {
		const { handlers, shown } = await loadSw([]);
		const w = waitable();
		handlers.push!({ ...w, data: { json: () => ({ title: "需要审批", body: "bash rm", url: "#/s/abc" }), text: () => "" } });
		await w.done();
		expect(shown).toEqual([{ title: "需要审批", options: { body: "bash rm", tag: undefined, data: { url: "#/s/abc" } } }]);
	});

	it("falls back to the text body for non-JSON payloads", async () => {
		const { handlers, shown } = await loadSw([]);
		const w = waitable();
		handlers.push!({ ...w, data: { json: () => { throw new Error("x"); }, text: () => "hello" } });
		await w.done();
		expect(shown[0]!.title).toBe("OMP");
		expect(shown[0]!.options.body).toBe("hello");
	});

	it("click focuses an open app window after routing it to #/s/<id>", async () => {
		const focus = vi.fn(async () => {});
		const client: FakeClient = { url: "https://phone.example/", focus, navigate: vi.fn(async () => ({ focus })), postMessage: vi.fn() };
		const { handlers, openWindow } = await loadSw([client]);
		const w = waitable();
		const close = vi.fn();
		handlers.notificationclick!({ ...w, notification: { close, data: { url: "#/s/abc" } } });
		await w.done();
		expect(close).toHaveBeenCalled();
		expect(client.navigate).toHaveBeenCalledWith("https://phone.example/#/s/abc");
		expect(focus).toHaveBeenCalled();
		expect(openWindow).not.toHaveBeenCalled();
	});

	it("click opens a new window when none exists, and rejects foreign origins", async () => {
		const { handlers, openWindow } = await loadSw([]);
		let w = waitable();
		handlers.notificationclick!({ ...w, notification: { close: vi.fn(), data: { url: "/s/xyz" } } });
		await w.done();
		expect(openWindow).toHaveBeenLastCalledWith("https://phone.example/#/s/xyz");
		w = waitable();
		handlers.notificationclick!({ ...w, notification: { close: vi.fn(), data: { url: "https://evil.example/x" } } });
		await w.done();
		expect(openWindow).toHaveBeenLastCalledWith("https://phone.example/");
	});

	it("asks the page to route when navigate() is refused", async () => {
		const focus = vi.fn(async () => {});
		const client: FakeClient = {
			url: "https://phone.example/",
			focus,
			navigate: vi.fn(async () => {
				throw new Error("nope");
			}),
			postMessage: vi.fn(),
		};
		const { handlers } = await loadSw([client]);
		const w = waitable();
		handlers.notificationclick!({ ...w, notification: { close: vi.fn(), data: { url: "#/s/q" } } });
		await w.done();
		expect(client.postMessage).toHaveBeenCalledWith({ type: "omp-navigate", url: "https://phone.example/#/s/q" });
	});
});
