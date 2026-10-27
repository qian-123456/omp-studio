/**
 * Hash-stack router.
 *
 * - Routes live in `location.hash` (`#/s/abc`); legacy deep links `#/s/:id` keep working.
 * - Every in-app navigation is a real history entry tagged `history.state = {d: depth}` so the
 *   browser/gesture back works like a stack; forward is allowed and simply re-derives the route.
 * - Landing on a deep link seeds the stack with `/` underneath, so back goes home instead of leaving the app.
 * - Overlays (sheets, dialogs, lightbox) register with `nav.pushLayer(close)`: the back gesture closes
 *   the overlay instead of navigating; closing it by UI pops its history entry again.
 */
import { useSyncExternalStore } from "react";

export type RouteName =
	| "home"
	| "chat"
	| "subagents"
	| "subagent"
	| "files"
	| "git"
	| "terminal"
	| "plan"
	| "sidechat"
	| "services"
	| "inbox"
	| "search"
	| "schedules"
	| "scheduleNew"
	| "schedule"
	| "scheduleRuns"
	| "skills"
	| "ideas"
	| "settings"
	| "settingsRoles"
	| "settingsProviders"
	| "settingsFallbacks"
	| "settingsContext"
	| "quota"
	| "notFound";

export interface Route {
	name: RouteName;
	/** Normalized path without query, e.g. `/s/abc/files`. */
	path: string;
	params: Record<string, string>;
	query: Record<string, string>;
}

/** Props every lazy route page receives (pages may also call `useRoute()`). */
export interface PageProps {
	route: Route;
}

/** Route patterns, most specific first. `:x` captures one URL-decoded segment. */
const PATTERNS: ReadonlyArray<readonly [RouteName, string]> = [
	["home", "/"],
	["chat", "/s/:id"],
	["subagents", "/s/:id/subagents"],
	["subagent", "/s/:id/subagents/:agentId"],
	["files", "/s/:id/files"],
	["git", "/s/:id/git"],
	["terminal", "/s/:id/terminal"],
	["plan", "/s/:id/plan"],
	["sidechat", "/s/:id/sidechat"],
	["services", "/s/:id/services"],
	["inbox", "/inbox"],
	["search", "/search"],
	["schedules", "/schedules"],
	["scheduleNew", "/schedules/new"],
	["scheduleRuns", "/schedules/:id/runs"],
	["schedule", "/schedules/:id"],
	["skills", "/skills"],
	["ideas", "/ideas"],
	["settings", "/settings"],
	["settingsRoles", "/settings/roles"],
	["settingsProviders", "/settings/providers"],
	["settingsFallbacks", "/settings/fallbacks"],
	["settingsContext", "/settings/context"],
	["quota", "/quota"],
];

const COMPILED = PATTERNS.map(([name, pattern]) => ({ name, segs: pattern.split("/").filter(Boolean) }));

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** Parse a hash/path string (`#/s/x?y=1`, `/s/x`) into a Route. Unknown paths → `notFound`. */
export function parseRoute(input: string): Route {
	let raw = input.startsWith("#") ? input.slice(1) : input;
	if (!raw.startsWith("/")) raw = `/${raw}`;
	const q = raw.indexOf("?");
	const pathPart = q >= 0 ? raw.slice(0, q) : raw;
	const query: Record<string, string> = {};
	if (q >= 0) new URLSearchParams(raw.slice(q + 1)).forEach((v, k) => (query[k] = v));
	const segs = pathPart.split("/").filter(Boolean);
	const path = `/${segs.join("/")}`;
	for (const { name, segs: pat } of COMPILED) {
		if (pat.length !== segs.length) continue;
		const params: Record<string, string> = {};
		let ok = true;
		for (let i = 0; i < pat.length; i++) {
			if (pat[i].startsWith(":")) params[pat[i].slice(1)] = safeDecode(segs[i]);
			else if (pat[i] !== segs[i]) {
				ok = false;
				break;
			}
		}
		if (ok) return { name, path, params, query };
	}
	return { name: "notFound", path, params: {}, query };
}

const enc = encodeURIComponent;
/** Path builders; pass the result to `nav.push`. */
export const paths = {
	home: () => "/",
	chat: (id: string) => `/s/${enc(id)}`,
	subagents: (id: string) => `/s/${enc(id)}/subagents`,
	subagent: (id: string, agentId: string) => `/s/${enc(id)}/subagents/${enc(agentId)}`,
	files: (id: string) => `/s/${enc(id)}/files`,
	git: (id: string) => `/s/${enc(id)}/git`,
	terminal: (id: string) => `/s/${enc(id)}/terminal`,
	plan: (id: string) => `/s/${enc(id)}/plan`,
	sidechat: (id: string) => `/s/${enc(id)}/sidechat`,
	services: (id: string) => `/s/${enc(id)}/services`,
	inbox: () => "/inbox",
	search: () => "/search",
	schedules: () => "/schedules",
	scheduleNew: () => "/schedules/new",
	schedule: (id: string) => `/schedules/${enc(id)}`,
	scheduleRuns: (id: string) => `/schedules/${enc(id)}/runs`,
	skills: () => "/skills",
	ideas: () => "/ideas",
	settings: () => "/settings",
	settingsRoles: () => "/settings/roles",
	settingsProviders: () => "/settings/providers",
	settingsFallbacks: () => "/settings/fallbacks",
	settingsContext: () => "/settings/context",
	quota: () => "/quota",
} as const;

/* ------------------------------------------------------------------ state */

interface NavSnapshot {
	route: Route;
	/** Number of in-app entries below the current one (0 = root). */
	depth: number;
}

const hashPath = () => (location.hash.startsWith("#") ? location.hash.slice(1) : location.hash) || "/";
const stateDepth = (): number | null => {
	const d = (history.state as { d?: unknown } | null)?.d;
	return typeof d === "number" ? d : null;
};

let snap: NavSnapshot = { route: parseRoute("/"), depth: 0 };
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());

function setSnap(route: Route, depth: number): void {
	if (snap.depth === depth && snap.route.path === route.path && sameQuery(snap.route.query, route.query)) return;
	snap = { route, depth };
	publish();
}
const sameQuery = (a: Record<string, string>, b: Record<string, string>) =>
	JSON.stringify(a) === JSON.stringify(b);

const hrefFor = (path: string) => `#${path.startsWith("/") ? path : `/${path}`}`;

/* Overlay layers: each owns one history entry on top of the current page. */
interface Layer {
	close: () => void;
}
const layers: Layer[] = [];
/** popstate events caused by our own history.back() that must not be interpreted. */
let ignorePops = 0;
let queued: Array<() => void> = [];
const run = (op: () => void) => (ignorePops > 0 ? queued.push(op) : op());

function syncFromLocation(depth: number): void {
	setSnap(parseRoute(hashPath()), depth);
}

function onPopState(): void {
	const d = stateDepth();
	if (ignorePops > 0) {
		ignorePops--;
		if (d !== null) syncFromLocation(d);
		if (ignorePops === 0) {
			const ops = queued;
			queued = [];
			ops.forEach((op) => op());
		}
		return;
	}
	if (d === null) {
		// A plain `<a href="#/x">` or manual hash edit: adopt it as one more stack entry.
		const depth = snap.depth + 1;
		history.replaceState({ d: depth }, "");
		closeAllLayers();
		syncFromLocation(depth);
		return;
	}
	// Back gesture over open overlays closes them one by one instead of navigating.
	let steps = snap.depth - d;
	while (steps > 0 && layers.length) {
		layers.pop()?.close();
		steps--;
	}
	syncFromLocation(d);
}

function closeAllLayers(): void {
	while (layers.length) layers.pop()?.close();
}

let initialized = false;
/** Idempotent; call once at boot before rendering. */
export function initNav(): void {
	if (initialized) return;
	initialized = true;
	const current = parseRoute(hashPath());
	const d = stateDepth();
	if (d !== null) {
		syncFromLocation(d);
	} else if (current.path !== "/") {
		// Deep link (e.g. legacy `#/s/:id`): put `/` underneath so back lands on home.
		history.replaceState({ d: 0 }, "", hrefFor("/"));
		history.pushState({ d: 1 }, "", hrefFor(rawTarget(current)));
		syncFromLocation(1);
	} else {
		history.replaceState({ d: 0 }, "", hrefFor("/"));
		syncFromLocation(0);
	}
	window.addEventListener("popstate", onPopState);
}

function rawTarget(r: Route): string {
	const q = new URLSearchParams(r.query).toString();
	return q ? `${r.path}?${q}` : r.path;
}

/* ------------------------------------------------------------------ API */

/**
 * Run `op` once no overlay owns a history entry: overlays are closed and their entries
 * rewound with a single `history.go(-n)`; `op` waits for that async traversal.
 */
function afterLayersClosed(op: () => void): void {
	run(() => {
		const n = layers.length;
		if (!n) return op();
		closeAllLayers();
		ignorePops++;
		queued.push(op);
		history.go(-n);
	});
}

export const nav = {
	/** Navigate to `path` (adds a history entry). Closes open overlays first. */
	push(path: string): void {
		afterLayersClosed(() => {
			if (hrefFor(path) === location.hash) return;
			history.pushState({ d: snap.depth + 1 }, "", hrefFor(path));
			syncFromLocation(snap.depth + 1);
		});
	},
	/** Swap the current entry (e.g. draft id → real session id) without growing history. */
	replace(path: string): void {
		afterLayersClosed(() => {
			history.replaceState({ d: snap.depth }, "", hrefFor(path));
			syncFromLocation(snap.depth);
		});
	},
	/** One step back; at the root of the stack navigates to home instead of leaving the app. */
	back(): void {
		if (layers.length || snap.depth > 0) history.back();
		else nav.replace("/");
	},
	/** Unwind the whole stack to home. */
	home(): void {
		run(() => {
			if (snap.depth > 0) {
				closeAllLayers();
				history.go(-snap.depth);
			} else nav.replace("/");
		});
	},
	/**
	 * Register an overlay: the back gesture calls `close` instead of navigating. Returns `dispose`,
	 * which MUST be called when the overlay closes by any other means (it pops the history entry).
	 */
	pushLayer(close: () => void): () => void {
		const layer: Layer = { close };
		layers.push(layer);
		history.pushState({ d: snap.depth + 1, layer: true }, "", location.hash || hrefFor("/"));
		setSnap(snap.route, snap.depth + 1);
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			const at = layers.indexOf(layer);
			if (at < 0) return; // already closed by the back gesture or a navigation
			layers.splice(at, 1);
			ignorePops++;
			history.back();
		};
	},
	getRoute: (): Route => snap.route,
	depth: (): number => snap.depth,
	canGoBack: (): boolean => snap.depth > 0,
};

function subscribe(l: () => void): () => void {
	listeners.add(l);
	return () => void listeners.delete(l);
}

/** Current route (re-renders on navigation). */
export function useRoute(): Route {
	return useSyncExternalStore(subscribe, () => snap.route);
}

/** `nav.depth() > 0`, reactive. */
export function useCanGoBack(): boolean {
	return useSyncExternalStore(subscribe, () => snap.depth > 0);
}

/** @internal test hook: forget module state so tests can start from a clean history. */
export function __resetNavForTests(): void {
	window.removeEventListener("popstate", onPopState);
	initialized = false;
	layers.length = 0;
	ignorePops = 0;
	queued = [];
	snap = { route: parseRoute("/"), depth: 0 };
}
