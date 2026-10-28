/**
 * Single EventSource (`/api/events`) fanned out over a typed bus.
 * - Probe `GET /api/sessions` before (re)connecting: EventSource cannot report an HTTP
 *   status, and a 401 must stop the retry loop instead of hammering the server.
 * - Exponential backoff 1,2,4,8,15 s ±20 %.
 * - Returning to the page (visibilitychange) or regaining network resyncs: reconnects when
 *   the stream died and emits a synthetic `resync` so views refetch.
 */
import type { RpcFrame } from "./types";
import { api } from "./api";
import { isUnauthorized, useConnection } from "./stores/connection";

export interface SseEventMap {
	/** Fires on every (re)connect of the stream. */
	hello: Record<string, never>;
	session: { sessionId: string; old?: string; new?: string };
	rpc: { sessionId: string; frame: RpcFrame };
	touch: { sessionId?: string };
	todos: Record<string, never>;
	/** Server asked for a full refetch, or the page became visible again / network returned. */
	resync: { reason?: "server" | "visible" | "online" };
}
export type SseEventName = keyof SseEventMap;
type Handler<K extends SseEventName> = (data: SseEventMap[K]) => void;

const RETRY_BASE_MS = 1000;
const RETRY_CAP_MS = 15_000;

/** Backoff for reconnect attempt `attempt` (0-based): 1,2,4,8,15,15… s with ±20 % jitter, never below 400 ms. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
	const n = Math.max(0, Math.min(6, Number(attempt) || 0));
	const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** n);
	const jitter = base * 0.2 * (random() * 2 - 1);
	return Math.round(Math.min(RETRY_CAP_MS, Math.max(400, base + jitter)));
}

const NAMES: readonly SseEventName[] = ["hello", "session", "rpc", "touch", "todos", "resync"];

export class EventBus {
	private handlers = new Map<SseEventName, Set<(data: never) => void>>();

	on<K extends SseEventName>(type: K, fn: Handler<K>): () => void {
		let set = this.handlers.get(type);
		if (!set) this.handlers.set(type, (set = new Set()));
		set.add(fn);
		return () => void set.delete(fn);
	}

	emit<K extends SseEventName>(type: K, data: SseEventMap[K]): void {
		const set = this.handlers.get(type) as Set<Handler<K>> | undefined;
		if (!set) return;
		for (const fn of [...set]) {
			try {
				fn(data);
			} catch (e) {
				console.error(`[sse] handler for ${type} failed`, e);
			}
		}
	}
}

/** App-wide bus; subscribe with `events.on("rpc", fn)` (returns an unsubscribe). */
export const events = new EventBus();

export interface EventSourceLike {
	readyState: number;
	onerror: ((e: unknown) => void) | null;
	addEventListener(type: string, fn: (e: { data: string }) => void): void;
	close(): void;
}

export interface SseDeps {
	create: (url: string) => EventSourceLike;
	probe: () => Promise<unknown>;
	random: () => number;
	bus: EventBus;
}

export class SseClient {
	private es: EventSourceLike | null = null;
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | 0 = 0;
	private started = false;

	constructor(private deps: SseDeps) {}

	start(): void {
		if (this.started) return;
		this.started = true;
		void this.probeAndConnect();
	}

	stop(): void {
		this.started = false;
		clearTimeout(this.timer);
		this.timer = 0;
		this.close();
	}

	/** Page became visible / network returned: revive a dead stream and tell views to refetch. */
	resume(reason: "visible" | "online"): void {
		if (!this.started || isUnauthorized()) return;
		if (!this.es || this.es.readyState === 2) {
			this.close();
			clearTimeout(this.timer);
			void this.probeAndConnect();
		} else if (this.es.readyState === 1) {
			useConnection.getState().setPhase("open");
		}
		this.deps.bus.emit("resync", { reason });
	}

	private close(): void {
		try {
			this.es?.close();
		} catch {
			/* already closed */
		}
		this.es = null;
	}

	private scheduleReconnect(): void {
		if (!this.started || isUnauthorized()) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.probeAndConnect(), backoffMs(this.attempt++, this.deps.random));
	}

	private async probeAndConnect(): Promise<void> {
		if (!this.started || isUnauthorized() || this.es) return;
		const conn = useConnection.getState();
		if (conn.phase !== "open") conn.setPhase("connecting");
		try {
			await this.deps.probe();
		} catch (e) {
			if (isUnauthorized()) return;
			useConnection.getState().setPhase("closed", e instanceof Error ? e.message : null);
			this.scheduleReconnect();
			return;
		}
		if (this.started && !isUnauthorized() && !this.es) this.connect();
	}

	private connect(): void {
		let src: EventSourceLike;
		try {
			src = this.deps.create("/api/events");
		} catch {
			useConnection.getState().setPhase("closed", "无法建立事件流");
			this.scheduleReconnect();
			return;
		}
		this.es = src;
		for (const name of NAMES) {
			src.addEventListener(name, (e) => {
				if (this.es !== src || isUnauthorized()) return;
				let data: unknown = {};
				try {
					data = e.data ? JSON.parse(e.data) : {};
				} catch {
					/* keep {} for malformed frames */
				}
				if (name === "hello") {
					this.attempt = 0;
					useConnection.getState().setPhase("open");
				}
				this.deps.bus.emit(name, data as never);
			});
		}
		src.onerror = () => {
			if (this.es !== src) return;
			this.close();
			if (isUnauthorized()) return;
			useConnection.getState().setPhase("closed");
			this.scheduleReconnect();
		};
	}
}

let client: SseClient | null = null;

/** Start the app-wide stream (idempotent) and wire visibility/online resync. */
export function startEvents(): void {
	if (client) return;
	client = new SseClient({
		create: (url) => new EventSource(url) as unknown as EventSourceLike,
		probe: () => api("GET", "/sessions"),
		random: Math.random,
		bus: events,
	});
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) client?.resume("visible");
	});
	window.addEventListener("online", () => client?.resume("online"));
	window.addEventListener("offline", () => useConnection.getState().setPhase("closed", "网络已断开"));
	client.start();
}

/** Re-probe now (banner "重试" button): restarts a stopped/closed stream. */
export function reconnectEvents(): void {
	if (!client) return startEvents();
	client.resume("online");
}
