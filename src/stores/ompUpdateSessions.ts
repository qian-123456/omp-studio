/**
 * Staleness-driven omp session switching. Live sessions keep running the omp
 * binary they were spawned from; when it is replaced (in-app `omp update` or
 * externally in a terminal) the backend reports them as stale. `syncStaleness`
 * restarts stale idle sessions right away (rpcRestart = kill + `--resume`,
 * transcript/draft/queue preserved) and watches stale busy ones, restarting
 * each the moment it goes idle.
 */
import { create } from "zustand";
import { errMsg } from "../lib/dialogs";
import { rpcOmpStaleness, rpcRestart } from "../lib/ipc";
import { toast } from "../lib/toast";
import { type SessionLive, useLive } from "./live";

export type LiveClass = "idle" | "busy" | "dead";

/** Classify a session's live state for switching purposes. */
export function classifyLive(live: Pick<SessionLive, "alive" | "streaming" | "pendingUi"> | undefined): LiveClass {
	if (!live || live.alive !== true) return "dead";
	return live.streaming !== true && live.pendingUi.length === 0 ? "idle" : "busy";
}

const TOAST_DEBOUNCE_MS = 1500;

interface SwitchState {
	/** Stale sessions waiting to go idle before being restarted. */
	pendingSessionIds: readonly string[];
	/** Last seen omp binary fingerprint (null = unknown / unresolvable). */
	fingerprint: string | null;
}

export const useOmpUpdateSessions = create<SwitchState>(() => ({ pendingSessionIds: [], fingerprint: null }));

export interface SyncOptions {
	/** The app itself just ran `omp update`: a fingerprint change is expected, not external. */
	selfUpdate?: boolean;
	/** Version label used in the switch toast. */
	version?: string;
}

/**
 * Called when the fingerprint changes from a known value without an in-app update.
 * Receives the stale-session count; returns the new version label for toasts.
 * Registered by the omp update store (avoids a circular import).
 */
type ExternalUpdateHandler = (staleCount: number) => Promise<string | null>;

let externalHandler: ExternalUpdateHandler | null = null;
let version: string | null = null;
let unsubscribe: (() => void) | null = null;
const restarting = new Set<string>();
let switched = 0;
const failures: string[] = [];
let toastTimer: NodeJS.Timeout | undefined;
let chain: Promise<void> = Promise.resolve();
/** A queued (not yet started) non-self sync that later callers can share. */
let queued: Promise<void> | null = null;

export function setExternalUpdateHandler(fn: ExternalUpdateHandler | null): void {
	externalHandler = fn;
}

function setPending(ids: Iterable<string>): void {
	const next = [...ids];
	useOmpUpdateSessions.setState({ pendingSessionIds: next });
	if (next.length === 0) stopWatch();
	else ensureWatch();
}

function removePending(id: string): void {
	const cur = useOmpUpdateSessions.getState().pendingSessionIds;
	if (cur.includes(id)) setPending(cur.filter((x) => x !== id));
}

function flushToast(): void {
	toastTimer = undefined;
	if (switched > 0) toast.success(`已将 ${switched} 个会话切换到 omp ${version ?? "新版本"}`);
	if (failures.length > 0) toast.error(`${failures.length} 个会话切换到新版 omp 失败：${failures[0]}`);
	switched = 0;
	failures.length = 0;
}

async function restartOne(id: string): Promise<boolean> {
	if (restarting.has(id)) return false;
	restarting.add(id);
	removePending(id);
	try {
		await rpcRestart(id);
		switched += 1;
		return true;
	} catch (e) {
		failures.push(errMsg(e));
		return false;
	} finally {
		restarting.delete(id);
		clearTimeout(toastTimer);
		toastTimer = setTimeout(flushToast, TOAST_DEBOUNCE_MS);
	}
}

function stopWatch(): void {
	unsubscribe?.();
	unsubscribe = null;
}

function onLiveChange(): void {
	const sessions = useLive.getState().sessions;
	for (const id of useOmpUpdateSessions.getState().pendingSessionIds) {
		const c = classifyLive(sessions[id]);
		if (c === "dead") removePending(id);
		else if (c === "idle") void restartOne(id);
	}
}

function ensureWatch(): void {
	if (!unsubscribe) unsubscribe = useLive.subscribe(onLiveChange);
}

async function runSync(opts: SyncOptions): Promise<void> {
	const res = await rpcOmpStaleness();
	const prev = useOmpUpdateSessions.getState().fingerprint;
	useOmpUpdateSessions.setState({ fingerprint: res.fingerprint });
	const sessions = useLive.getState().sessions;
	const idle: string[] = [];
	const busy: string[] = [];
	for (const id of res.staleSessionIds) {
		const c = classifyLive(sessions[id]);
		if (c === "idle") idle.push(id);
		else if (c === "busy") busy.push(id);
	}
	if (opts.version) version = opts.version;
	const external = !opts.selfUpdate && prev !== null && res.fingerprint !== null && prev !== res.fingerprint;
	if (external && externalHandler) {
		try {
			const v = await externalHandler(idle.length + busy.length);
			if (v) version = v;
		} catch {
			// Version refresh is best-effort; switching proceeds regardless.
		}
	}
	setPending(busy);
	// Sequential: avoid spawning many omp processes at once.
	for (const id of idle) await restartOne(id);
}

/**
 * Ask the backend which live sessions run an outdated omp and switch them.
 * Runs are serialized; concurrent non-self calls share one queued run.
 */
export function syncStaleness(opts: SyncOptions = {}): Promise<void> {
	if (!opts.selfUpdate && queued) return queued;
	const p = chain.then(() => {
		if (queued === p) queued = null;
		return runSync(opts);
	});
	if (!opts.selfUpdate) queued = p;
	chain = p.catch(() => {});
	return p;
}

/** Force: restart every pending (stale, busy) session now. Returns the success count. */
export async function switchPendingNow(): Promise<number> {
	let ok = 0;
	for (const id of [...useOmpUpdateSessions.getState().pendingSessionIds]) if (await restartOne(id)) ok += 1;
	return ok;
}

/** Test-only reset of module state. */
export function __resetForTests(): void {
	stopWatch();
	restarting.clear();
	switched = 0;
	failures.length = 0;
	version = null;
	externalHandler = null;
	chain = Promise.resolve();
	queued = null;
	clearTimeout(toastTimer);
	toastTimer = undefined;
	useOmpUpdateSessions.setState({ pendingSessionIds: [], fingerprint: null });
}
