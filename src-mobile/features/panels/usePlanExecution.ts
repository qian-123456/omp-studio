import { useCallback, useContext, useSyncExternalStore } from "react";
import type { PlanStatus } from "../../../src/features/chat/plan/planStatus";
import { api, errorMessage } from "../../core/api";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import { isDraftId } from "../../core/types";
import { ChatCtx } from "../chat/ChatContext";
import type { ComposerState } from "../chat/chatStore";

interface Snapshot {
	data: ComposerState | null;
	error: string | null;
	loading: boolean;
}

const EMPTY: Snapshot = { data: null, error: null, loading: true };
const COALESCE_MS = 600;
const FALLBACK_MS = 5000;
const sources = new Map<string, PlanExecutionSource>();

/** One owned loader per mounted session, never one poller per component. */
class PlanExecutionSource {
	snapshot: Snapshot = EMPTY;
	listeners = new Set<() => void>();
	private controller: AbortController | null = null;
	private pending: Promise<void> | null = null;
	private queued = false;
	private refreshTimer = 0;
	private fallbackTimer = 0;
	private lastStart = 0;
	private offs: Array<() => void> = [];

	constructor(readonly id: string) {}

	private publish(snapshot: Snapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}

	private clearWork(): void {
		window.clearTimeout(this.refreshTimer);
		window.clearTimeout(this.fallbackTimer);
		this.refreshTimer = 0;
		this.fallbackTimer = 0;
		this.queued = false;
		this.controller?.abort();
		this.controller = null;
		this.pending = null;
	}

	private armFallback(): void {
		window.clearTimeout(this.fallbackTimer);
		this.fallbackTimer = 0;
		const data = this.snapshot.data;
		const running = data?.streaming || data?.planStatus?.approved?.status === "executing" || useSessions.getState().byId[this.id]?.status === "working";
		if (this.listeners.size && !document.hidden && (running || data === null)) {
			this.fallbackTimer = window.setTimeout(() => {
				this.fallbackTimer = 0;
				this.schedule();
			}, FALLBACK_MS);
		}
	}

	private schedule = (): void => {
		if (!this.listeners.size || document.hidden) return;
		if (this.pending) {
			this.queued = true;
			return;
		}
		if (this.refreshTimer) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = 0;
			void this.reload();
		}, Math.max(0, COALESCE_MS - (Date.now() - this.lastStart)));
	};

	reload = (): Promise<void> => {
		if (!this.listeners.size || document.hidden || isDraftId(this.id)) return Promise.resolve();
		if (this.pending) {
			this.queued = true;
			return this.pending;
		}
		window.clearTimeout(this.refreshTimer);
		window.clearTimeout(this.fallbackTimer);
		this.refreshTimer = 0;
		this.fallbackTimer = 0;
		this.lastStart = Date.now();
		const controller = new AbortController();
		this.controller = controller;
		this.publish({ ...this.snapshot, loading: this.snapshot.data === null, error: null });
		this.pending = (async () => {
			try {
				const data = await api<ComposerState>("GET", `/sessions/${encodeURIComponent(this.id)}/composer-state`, undefined, { signal: controller.signal });
				if (this.controller === controller && !controller.signal.aborted) this.publish({ data, error: null, loading: false });
			} catch (error) {
				if (this.controller === controller && !controller.signal.aborted) {
					this.publish({ ...this.snapshot, error: errorMessage(error, "计划状态加载失败"), loading: false });
				}
			} finally {
				if (this.controller === controller) {
					this.controller = null;
					this.pending = null;
					const again = this.queued;
					this.queued = false;
					if (again) this.schedule();
					this.armFallback();
				}
			}
		})();
		return this.pending;
	};

	start(): void {
		if (isDraftId(this.id)) {
			this.publish({ data: { planStatus: null, streaming: false }, error: null, loading: false });
			return;
		}
		this.offs = [
			events.on("hello", this.schedule),
			events.on("resync", this.schedule),
			events.on("rpc", (event) => { if (event.sessionId === this.id) this.schedule(); }),
			events.on("session", (event) => { if (event.sessionId === this.id) this.schedule(); }),
			events.on("touch", (event) => { if (!event.sessionId || event.sessionId === this.id) this.schedule(); }),
		];
		const onVisibility = () => {
			if (document.hidden) this.clearWork();
			else void this.reload();
		};
		document.addEventListener("visibilitychange", onVisibility);
		this.offs.push(() => document.removeEventListener("visibilitychange", onVisibility));
		void this.reload();
	}

	stop(): void {
		this.clearWork();
		for (const off of this.offs) off();
		this.offs = [];
	}
}

function subscribe(id: string, listener: () => void): () => void {
	const source = sources.get(id) ?? new PlanExecutionSource(id);
	if (!sources.has(id)) sources.set(id, source);
	source.listeners.add(listener);
	if (source.listeners.size === 1) source.start();
	return () => {
		source.listeners.delete(listener);
		if (!source.listeners.size) {
			source.stop();
			if (sources.get(id) === source) sources.delete(id);
		}
	};
}

/** Chat reuses its existing controller; tool routes own a shared read-only snapshot. */
export function usePlanExecution(sessionId: string): {
	planStatus: PlanStatus | null;
	executing: boolean;
	loading: boolean;
	error: string | null;
	reload: () => Promise<void>;
} {
	const context = useContext(ChatCtx);
	const controller = context?.controller.id === sessionId ? context.controller : null;
	const subscribeChat = useCallback((listener: () => void) => controller ? controller.store.subscribe(listener) : () => {}, [controller]);
	const getChatSnapshot = useCallback(() => controller?.state.cstate ?? null, [controller]);
	const chatState = useSyncExternalStore(subscribeChat, getChatSnapshot, getChatSnapshot);
	const subscribePanel = useCallback((listener: () => void) => controller ? () => {} : subscribe(sessionId, listener), [controller, sessionId]);
	const getPanelSnapshot = useCallback(() => controller ? EMPTY : sources.get(sessionId)?.snapshot ?? EMPTY, [controller, sessionId]);
	const panel = useSyncExternalStore(subscribePanel, getPanelSnapshot, getPanelSnapshot);
	const reload = useCallback(async () => {
		if (controller) await controller.loadState();
		else await sources.get(sessionId)?.reload();
	}, [controller, sessionId]);
	const planStatus = (controller ? chatState : panel.data)?.planStatus ?? null;
	return {
		planStatus,
		executing: planStatus?.approved?.status === "executing",
		loading: controller ? chatState === null : panel.loading,
		error: controller ? null : panel.error,
		reload,
	};
}
