// @vitest-environment jsdom
/**
 * THROWAWAY repro for: BottomBar omp version chip (openSettings("about"))
 * lands Settings overlay on "general" instead of "about".
 * Mirrors App.tsx: lazy SettingsOverlay inside a shared Suspense boundary
 * under React.StrictMode.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { Suspense, lazy } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { useUi } from "../../stores/ui";
import type { SettingsOverlay as SettingsOverlayType } from "./SettingsOverlay";

// --- mocks: everything Tauri/IPC-facing, keep the shell logic real ---
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), emit: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(() => Promise.resolve("0.0.0-test")) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

vi.mock("../../lib/ipc", () =>
	new Proxy(
		{},
		{
			get: (_t, prop) => {
				if (prop === "__esModule") return true;
				return vi.fn(() => Promise.reject(new Error("no tauri")));
			},
		},
	),
);

vi.mock("./store", () => ({
	useSettings: create(() => ({
		settings: {},
		error: null,
		load: vi.fn(() => Promise.resolve()),
	})),
	DEFAULT_SETTINGS: {},
	ensureSettings: (s: unknown) => s,
	_resetSettingsStore: () => {},
}));

vi.mock("./ompConfigStore", () => ({
	useOmpConfigStore: create(() => ({
		entries: [],
		load: vi.fn(() => Promise.resolve()),
	})),
}));

vi.mock("./OmpConfigSection", () => ({
	OmpConfigSection: () => <div data-testid="omp-section" />,
}));

vi.mock("./sections/index", () => ({
	SECTION_COMPONENTS: new Proxy(
		{},
		{
			get: (_t, prop) => {
				if (typeof prop !== "string") return undefined;
				const Stub = () => <div data-testid={`section-${prop}`} />;
				Stub.displayName = `Stub-${prop}`;
				return Stub;
			},
		},
	),
}));

// Sibling lazy modals like App.tsx — resolve slower than the settings chunk
const SlowLazyA = lazy(
	() => new Promise<{ default: () => null }>((r) => setTimeout(() => r({ default: () => null }), 60)),
);
const SlowLazyB = lazy(
	() => new Promise<{ default: () => null }>((r) => setTimeout(() => r({ default: () => null }), 80)),
);
const SettingsOverlay = lazy(
	() =>
		new Promise<{ default: typeof SettingsOverlayType }>((r) =>
			setTimeout(() => import("./SettingsOverlay").then((m) => r({ default: m.SettingsOverlay })), 30),
		),
);

function Harness() {
	return (
		<React.StrictMode>
			<button
				type="button"
				data-testid="chip"
				onClick={() => useUi.getState().openSettings("about")}
			/>
			<Suspense fallback={null}>
				<SlowLazyA />
				<SlowLazyB />
				<SettingsOverlay />
			</Suspense>
		</React.StrictMode>
	);
}

function activeNavId(): string | null {
	return document.querySelector("[data-nav-id][aria-current='page']")?.getAttribute("data-nav-id") ?? null;
}

// React 19 requires this global for act().
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

// jsdom does not implement scroll APIs used by the page's effects.
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

beforeEach(() => {
	cleanup();
	actEnv.IS_REACT_ACT_ENVIRONMENT = true;
	useUi.setState({
		centerView: "home",
		previousCenterView: null,
		settingsSection: null,
		settingsFocus: null,
	});
	localStorage.clear();
});

describe("settings deep link", () => {
	it("openSettings('about') on first open lands on about", async () => {
		render(<Harness />);
		// chunk still loading when the chip is clicked
		act(() => {
			screen.getByTestId("chip").click();
		});
		await waitFor(() => expect(document.querySelector("[data-nav-id]")).toBeTruthy(), {
			timeout: 3000,
		});
		await waitFor(() => expect(activeNavId()).toBe("about"));
	});

	it("openSettings('appearance') while already open switches section", async () => {
		render(<Harness />);
		act(() => {
			screen.getByTestId("chip").click();
		});
		await waitFor(() => expect(document.querySelector("[data-nav-id]")).toBeTruthy(), {
			timeout: 3000,
		});
		await waitFor(() => expect(activeNavId()).toBe("about"));
		act(() => {
			useUi.getState().openSettings("appearance");
		});
		await waitFor(() => expect(activeNavId()).toBe("appearance"));
	});

	it("openSettings with omp-* focusKey lands on omp section", async () => {
		render(<Harness />);
		act(() => {
			useUi.getState().openSettings("omp-tools", { focusKey: "tools.approvalMode" });
		});
		await waitFor(() => expect(document.querySelector("[data-nav-id]")).toBeTruthy(), {
			timeout: 3000,
		});
		await waitFor(() => expect(activeNavId()).toBe("omp-tools"));
	});
});
