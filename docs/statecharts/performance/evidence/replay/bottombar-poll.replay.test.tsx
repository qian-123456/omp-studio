// @vitest-environment jsdom
// Replays the BottomBar performance-poller statechart findings through the real
// <BottomBar/> + real <PerfPopover/>, faking ONLY the Tauri IPC boundary
// (@tauri-apps/api/core invoke) and browser layout primitives (jsdom zero
// rects). This is NOT a native renderer or CSS/visual check.
//
// Baseline: omp-workspace f6de72f (src/components/BottomBar.tsx poll effect,
// lines 81-146; src/features/chat/PerfPopover.tsx display wiring).
//
// Findings replayed (parent TLA+ models in <scratch>):
//   1. RefreshOverlap.tla    — regression gate: opening the panel while the
//                              closed-mode probe is pending starts an
//                              overlapping second request (normal user-event
//                              path; effect-local `inFlight` resets on the
//                              perfOpen effect re-run).
//   2. PartialFailure.tla    — regression gate: with the panel open, one
//                              rejected sibling probe discards the other
//                              fresh results (Promise.all + empty catch).
//                              LABEL: IPC boundary fault injection — the
//                              backend's ordinary scan failures degrade to
//                              "unknown" payloads and are unreachable as Err
//                              (src-tauri/src/services/commands.rs:11-15,
//                              557-561), so this exercises the transport/
//                              rejection contract, not a confirmed real-world
//                              service-scan failure. The rule under test:
//                              independent successful results must survive a
//                              sibling rejection.
//   3. SnapshotAgreement.tla — witness (passing): bar label (app_memory_usage
//                              sample) and popover 本程序 value (perf_breakdown
//                              app bucket) render two distinct same-tick
//                              samples of the same quantity.
//   4. MemoryPartition.tla   — witness (passing): a crafted inconsistent
//                              partition (segment widths summing 112.5%) is
//                              accepted by the real popover without any
//                              guard/fallback; no CSS-overflow or OS
//                              feasibility claim is made.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MB = 1024 * 1024;

// Deferred-reply IPC harness: every invoke records the command and either
// resolves immediately with the staged payload or parks a deferred reply.
const H = vi.hoisted(() => ({
	calls: [] as string[],
	mode: {} as Record<string, "resolve" | "defer">,
	payload: {} as Record<string, unknown>,
	pending: {} as Record<string, Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>>,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string) => {
		H.calls.push(cmd);
		if ((H.mode[cmd] ?? "resolve") === "defer") {
			return new Promise<unknown>((resolve, reject) => {
				(H.pending[cmd] ??= []).push({ resolve, reject });
			});
		}
		return Promise.resolve(H.payload[cmd]);
	},
	convertFileSrc: (p: string) => p,
	Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide: vi.fn(), onFocusChanged: async () => () => {}, onResized: async () => () => {}, isFullscreen: async () => false, setTitle: async () => {}, label: "main" }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
// jsdom lacks these browser APIs; assign minimal stand-ins without casts.
const G = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
if (!G.ResizeObserver) G.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!G.matchMedia)
	G.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

import { BottomBar } from "app-src/components/BottomBar";

// ---- payload builders (contract shapes from src/lib/contracts.ts) ----
const mem = (formatted: string, processes = 3) => ({ residentMb: 100, formatted, processes });
const svc = () => ({
	pid: 4242, name: "omp-web-a", port: 8080, cwd: "/p/wsA",
	command: "omp serve --port 8080", url: "http://127.0.0.1:8080",
	sessionId: null, startedByApp: true, memoryKb: 1024,
});
const bd = (over: Record<string, unknown> = {}) => ({
	app: { bytes: 111 * MB, processes: 3 },
	ompSpawned: { bytes: 5 * MB, processes: 2 },
	ompExternal: { bytes: 7 * MB, processes: 1 },
	barOmpBytes: 12 * MB,
	otherBytes: 7877 * MB, // used 8000 − app 111 − omp 12, keeps default samples valid
	totalBytes: 16384 * MB,
	usedBytes: 8000 * MB,
	freeBytes: 8384 * MB,
	instances: [],
	generatedAt: 1,
	...over,
});

const calls = (cmd: string) => H.calls.filter((c) => c === cmd);
/** Settle every parked reply of one command (FIFO order is irrelevant here:
 * cross-generation replies are discarded by the component's cancelled flag). */
const releaseAll = (cmd: string, value: unknown, fail = false) => {
	for (const d of H.pending[cmd] ?? []) void (fail ? d.reject(value) : d.resolve(value));
	H.pending[cmd] = [];
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
/** Click the perf chip (only bottom-bar button whose label carries an MB value). */
const clickPerf = (bar: HTMLElement) =>
	act(() => {
		const btn = [...bar.querySelectorAll("button")].find((b) => /MB/.test(b.textContent ?? ""));
		if (!btn) throw new Error("perf chip not found");
		fireEvent.click(btn);
	});
const bodyText = () => document.body.textContent ?? "";

beforeEach(() => {
	H.calls = [];
	H.mode = {};
	H.payload = {};
	H.pending = {};
	H.payload.services_list = [svc()];
});
afterEach(() => cleanup());

describe("perf poller replay (baseline f6de72f, jsdom IPC boundary)", () => {
	it("RefreshOverlap.tla: opening the panel while the closed-mode probe is pending must not start an overlapping second request", async () => {
		H.mode = { app_memory_usage: "defer" };
		const r = render(<BottomBar />);
		await settle();
		expect(calls("app_memory_usage")).toHaveLength(1); // closed-mode bar poll parked

		clickPerf(r.container.querySelector("[data-app-bottombar]") as HTMLElement);
		const appCalls = calls("app_memory_usage").length;
		console.log("[RefreshOverlap] app_memory_usage in flight on open =", appCalls,
			"; services_list =", calls("services_list").length,
			"; perf_breakdown =", calls("perf_breakdown").length);

		// Desired single-flight invariant: still exactly one pending probe.
		expect(appCalls).toBe(1); // FAILS at baseline (2): effect-local inFlight reset

		releaseAll("app_memory_usage", mem("101 MB"));
		await settle();
	});

	it("PartialFailure.tla [IPC boundary fault injection]: fresh successful probes must survive a sibling rejection", async () => {
		H.mode = { app_memory_usage: "defer", services_list: "defer", perf_breakdown: "defer" };
		const r = render(<BottomBar />);
		await settle();
		expect(calls("app_memory_usage")).toHaveLength(1);

		// Cycle 1 (closed mode): bar label seeds from the memory probe.
		releaseAll("app_memory_usage", mem("101 MB"));
		await settle();
		expect(bodyText()).toContain("101 MB");

		// User opens the panel → open-mode cycle parks all three probes.
		clickPerf(r.container.querySelector("[data-app-bottombar]") as HTMLElement);
		expect(calls("app_memory_usage")).toHaveLength(2);
		expect(calls("services_list")).toHaveLength(1);
		expect(calls("perf_breakdown")).toHaveLength(1);

		// Cycle 2: services_list rejects at the IPC boundary; the other two succeed.
		releaseAll("app_memory_usage", mem("202 MB"));
		releaseAll("perf_breakdown", bd({ app: { bytes: 222 * MB, processes: 4 } }));
		releaseAll("services_list", new Error("mock ipc rejection: services_list"), true);
		await settle();

		const text = bodyText();
		const freshBar = text.includes("202 MB");
		const freshPopover = text.includes("222 MB");
		// Baseline note: perfData starts null here (the only open cycle's
		// breakdown was discarded), so the distribution shows the collecting
		// placeholder and the 本程序 row falls back to the stale "101 MB" —
		// there is no stale "111 MB" to find.
		const trackRendered = document.querySelector(".h-2") !== null;
		console.log("[PartialFailure] independent display consequences: fresh bar 202 MB =", freshBar,
			"; fresh popover 222 MB =", freshPopover,
			"; stale 101 MB still shown =", text.includes("101 MB"),
			"; distribution track rendered (false = bd null → collecting placeholder) =", trackRendered);

		// Desired rule: independent successful results survive the rejection.
		// One combined signal so the baseline failure message carries BOTH
		// display consequences (bar label AND popover app value).
		expect(`${freshBar}|${freshPopover}`).toBe("true|true"); // FAILS at baseline: "false|false"
		expect(trackRendered, "fresh breakdown should render the distribution track (baseline: bd null → collecting)").toBe(true);
	});

	it("SnapshotAgreement.tla [witness, not a regression gate]: bar label and popover app value render two distinct same-tick samples", async () => {
		H.mode = { app_memory_usage: "defer", perf_breakdown: "defer" };
		const r = render(<BottomBar />);
		await settle();

		clickPerf(r.container.querySelector("[data-app-bottombar]") as HTMLElement);
		// Same open-mode cycle answers the two app-memory probes with distinct samples.
		releaseAll("app_memory_usage", mem("101 MB"));
		releaseAll("perf_breakdown", bd({ app: { bytes: 222 * MB, processes: 4 } }));
		await settle();

		const text = bodyText();
		const barSample = text.includes("101 MB");
		const popoverSample = text.includes("222 MB");
		console.log("[SnapshotAgreement] one cycle issued app_memory_usage x",
			calls("app_memory_usage").length, "+ perf_breakdown x", calls("perf_breakdown").length,
			"; same tick renders bar sample 101 MB =", barSample,
			"and breakdown app sample 222 MB =", popoverSample);

		expect(calls("app_memory_usage")).toHaveLength(2); // mount cycle + open cycle
		expect(calls("perf_breakdown")).toHaveLength(1);
		expect(barSample).toBe(true); // bottom bar chip (app_memory_usage sample)
		expect(popoverSample).toBe(true); // popover 本程序 row (perf_breakdown app bucket)
	});

	it("MemoryPartition.tla [witness]: crafted inconsistent partition accepted, segment widths sum 112.5%", async () => {
		H.mode = { app_memory_usage: "defer", perf_breakdown: "defer" };
		const r = render(<BottomBar />);
		await settle();

		clickPerf(r.container.querySelector("[data-app-bottombar]") as HTMLElement);
		releaseAll("app_memory_usage", mem("50 MB"));
		releaseAll("perf_breakdown", bd({
			totalBytes: 16, usedBytes: 8,
			app: { bytes: 2, processes: 1 },
			// bar_omp = spawned + external requires BOTH known: 8 + 0 = 8.
			ompSpawned: { bytes: 8, processes: 2 },
			ompExternal: { bytes: 0, processes: 1 },
			barOmpBytes: 8, otherBytes: 0, freeBytes: 8,
		}));
		await settle();

		const track = document.body.querySelector<HTMLElement>(".h-2");
		const widths = [...(track?.children ?? [])].map((el) => (el as HTMLElement).style.width);
		const sum = widths.reduce((a, w) => a + Number.parseFloat(w), 0);
		console.log("[MemoryPartition] rendered segment widths =", widths.join(" + "), "=", sum + "%",
			"; guard/fallback branch taken =", track === null);

		expect(track).not.toBeNull(); // inconsistent partition rendered, not rejected to fallback
		expect(widths).toEqual(["12.5%", "50%", "50%"]); // other 0% skipped
		expect(sum).toBeCloseTo(112.5, 5); // accepted, no width guard
	});
});
