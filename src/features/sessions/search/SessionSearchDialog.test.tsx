// @vitest-environment jsdom
/**
 * Global session search dialog: instant metadata tier + debounced content tier,
 * stale-response discard, keyboard navigation (IME-safe), empty-query recents,
 * the index-building notice and error/empty states.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchIndexStatus, SessionSearchHit } from "../../../lib/contracts";

const h = vi.hoisted(() => ({
	searchSessions: vi.fn(),
	searchIndexStatus: vi.fn(),
	progress: { cb: null as ((s: SearchIndexStatus) => void) | null },
	openSearchRow: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.reject(new Error("no tauri"))) }));
vi.mock("../../../lib/ipc", () => ({
	searchSessions: h.searchSessions,
	searchIndexStatus: h.searchIndexStatus,
}));
vi.mock("../../../lib/events", () => ({
	onSearchIndexProgress: vi.fn(async (cb: (s: SearchIndexStatus) => void) => {
		h.progress.cb = cb;
		return () => {
			h.progress.cb = null;
		};
	}),
}));
vi.mock("./openSearchRow", () => ({ openSearchRow: h.openSearchRow }));

import { useLive } from "../../../stores/live";
import { useLanguageStore } from "../../../stores/language";
import { useSessions } from "../../../stores/sessions";
import { useSidebarStore } from "../sidebarStore";
import { SessionSearchDialog } from "./SessionSearchDialog";
import { useSearchDialog } from "./searchStore";
import { makeHit, makeSession } from "./testFixtures";

const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

function seed() {
	const list = [
		makeSession({ id: "s-today", title: "今日修复登录", updatedAt: iso(0) }),
		makeSession({ id: "s-week", title: "整理周报", updatedAt: iso(4) }),
		makeSession({ id: "s-old", title: "旧项目复盘", updatedAt: iso(90) }),
		makeSession({ id: "s-arch", title: "归档的登录笔记", archived: true, updatedAt: iso(2) }),
		makeSession({ id: "s-chat", title: "闲聊登录话题", mode: "chat", updatedAt: iso(1) }),
	];
	useSessions.setState({ sessions: Object.fromEntries(list.map((s) => [s.id, s])), workspaces: [] });
}

const input = () => screen.getByRole("combobox", { name: "搜索会话" }) as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const options = () => screen.getAllByRole("option");
const selectedOption = () => options().find((o) => o.getAttribute("aria-selected") === "true");

beforeEach(() => {
	useLanguageStore.setState({ locale: "zh-CN" });
	h.searchSessions.mockReset().mockResolvedValue([]);
	h.searchIndexStatus.mockReset().mockResolvedValue({ indexed: 0, total: 0, building: false });
	h.openSearchRow.mockReset();
	h.progress.cb = null;
	useLive.setState({ sessions: {} });
	useSidebarStore.setState({ activeMode: "code" });
	seed();
	useSearchDialog.setState({ open: true, focusSeq: 1 });
});
afterEach(() => {
	cleanup();
	useSearchDialog.setState({ open: false });
});

function mount() {
	return render(<SessionSearchDialog />);
}

describe("empty query", () => {
	it("lists 最近会话 grouped by time bucket, newest first, with no 新建会话 row", () => {
		mount();
		const opts = options();
		expect(screen.queryByText("新建会话")).toBeNull();
		const text = document.body.textContent ?? "";
		const order = ["今天", "昨天", "过去 7 天", "过去 30 天", "更早"].filter((l) => text.includes(l));
		// today (s-today), yesterday (s-chat), last 7 days (s-arch, s-week), earlier (s-old)
		expect(order).toEqual(["今天", "昨天", "过去 7 天", "更早"]);
		expect(opts.map((o) => o.querySelector("span")?.textContent)).toEqual([
			"今日修复登录",
			"闲聊登录话题",
			"归档的登录笔记",
			"整理周报",
			"旧项目复盘",
		]);
		expect(selectedOption()).toBe(opts[0]);
	});

	it("Enter opens the highlighted first recent session and closes", () => {
		mount();
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(h.openSearchRow.mock.calls[0][0].session.id).toBe("s-today");
		expect(useSearchDialog.getState().open).toBe(false);
	});

	it("shows relative time plus workspace · branch so same-titled sessions are distinguishable", () => {
		useSessions.setState({
			workspaces: [{ id: "ws1", name: "alpha", path: "/repo/alpha", kind: "project", sort: 0, mode: "code" }],
			sessions: {
				a: makeSession({ id: "a", title: "#116 QUEUE: x", workspaceId: "ws1", git: { branch: "main", dirty: 0, worktree: null } as never, updatedAt: iso(0) }),
				b: makeSession({ id: "b", title: "#116 QUEUE: x", updatedAt: iso(4) }),
			},
		});
		mount();
		const [rowA, rowB] = options();
		expect(within(rowA).getByText("alpha · main")).toBeTruthy();
		expect(within(rowA).getByText("刚刚")).toBeTruthy();
		expect(within(rowB).getByText("4天")).toBeTruthy();
		expect(rowB.querySelector("[data-session-place]")).toBeNull();
	});

	it("marks archived sessions and other-mode sessions", () => {
		mount();
		expect(screen.getByText("已归档")).toBeTruthy();
		const chatRow = screen.getByText("闲聊登录话题").closest("[role=option]") as HTMLElement;
		expect(within(chatRow).getByText("Universal")).toBeTruthy();
		const todayRow = screen.getByText("今日修复登录").closest("[role=option]") as HTMLElement;
		expect(within(todayRow).queryByText("Code")).toBeNull();
	});
});

describe("typing", () => {
	it("shows metadata hits instantly and calls the content search only after the debounce", async () => {
		mount();
		type("登录");
		// Instant tier, no IPC yet.
		expect(options().map((o) => o.textContent)).toEqual(
			expect.arrayContaining([expect.stringContaining("今日修复登录")]),
		);
		expect(h.searchSessions).not.toHaveBeenCalled();
		await waitFor(() => expect(h.searchSessions).toHaveBeenCalledWith("登录", expect.any(Number)));
		expect(h.searchSessions).toHaveBeenCalledTimes(1);
	});

	it("merges: metadata rows first, then content-only rows; one row per session; title+content row carries the snippet", async () => {
		const hits: SessionSearchHit[] = [
			makeHit("s-old", {
				role: "assistant",
				segments: [
					{ text: "之前讨论过 ", hit: false },
					{ text: "登录", hit: true },
					{ text: " 的方案", hit: false },
				],
				truncatedStart: true,
			}),
			makeHit("s-today", { segments: [{ text: "登录", hit: true }] }),
		];
		h.searchSessions.mockResolvedValue(hits);
		mount();
		type("登录");
		await waitFor(() => expect(screen.getByText("助手")).toBeTruthy());

		const rows = options();
		const ids = rows.map((r) => r.textContent ?? "");
		// metadata (newest first): today, chat(1d), archived(2d); then content-only: old
		expect(ids[0]).toContain("今日修复登录");
		expect(ids[0]).toContain("你"); // title row WITH its snippet
		expect(ids[ids.length - 1]).toContain("旧项目复盘");
		expect(ids.filter((t) => t.includes("今日修复登录"))).toHaveLength(1);

		const oldRow = rows[rows.length - 1];
		const mark = oldRow.querySelector("mark");
		expect(mark?.textContent).toBe("登录");
		expect(oldRow.textContent).toContain("…之前讨论过 登录 的方案");
		expect(within(oldRow).getByText("助手")).toBeTruthy();
	});

	it("discards a stale response that resolves after a newer query's", async () => {
		const pending: Array<(v: SessionSearchHit[]) => void> = [];
		h.searchSessions.mockImplementation(
			() => new Promise<SessionSearchHit[]>((res) => pending.push(res)),
		);
		mount();
		type("旧");
		await waitFor(() => expect(h.searchSessions).toHaveBeenCalledTimes(1));
		type("旧项");
		await waitFor(() => expect(h.searchSessions).toHaveBeenCalledTimes(2));

		await act(async () => {
			pending[1]([makeHit("s-week", { segments: [{ text: "新结果", hit: true }] })]);
		});
		await waitFor(() => expect(screen.getByText("新结果")).toBeTruthy());
		await act(async () => {
			pending[0]([makeHit("s-arch", { segments: [{ text: "过期结果", hit: true }] })]);
		});
		expect(screen.queryByText("过期结果")).toBeNull();
		expect(screen.getByText("新结果")).toBeTruthy();
	});

	it("shows the full IPC error, selectable", async () => {
		const msg = "index corrupted: line 1\nline 2 /very/long/path/that/must/not/be/cut";
		h.searchSessions.mockRejectedValue(msg);
		mount();
		type("x");
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(msg);
		expect(alert.className).toContain("select-text");
	});

	it("shows 没有找到相关会话 only when nothing matched and nothing is pending", async () => {
		mount();
		type("zzzz-nothing");
		expect(screen.queryByText("没有找到相关会话")).toBeNull();
		expect(screen.getByRole("status", { name: "正在搜索" })).toBeTruthy();
		await waitFor(() => expect(screen.getByText("没有找到相关会话")).toBeTruthy());
		expect(screen.queryByRole("status", { name: "正在搜索" })).toBeNull();
	});
});

describe("keyboard", () => {
	it("↑/↓ move the highlight (wrapping) and Enter opens the highlighted row", () => {
		mount();
		type("登录");
		expect(selectedOption()?.textContent).toContain("今日修复登录");
		fireEvent.keyDown(input(), { key: "ArrowDown" });
		expect(selectedOption()?.textContent).toContain("闲聊登录话题");
		fireEvent.keyDown(input(), { key: "ArrowUp" });
		fireEvent.keyDown(input(), { key: "ArrowUp" }); // wraps to the last row
		expect(selectedOption()).toBe(options()[options().length - 1]);
		fireEvent.keyDown(input(), { key: "ArrowDown" }); // wraps back
		fireEvent.keyDown(input(), { key: "Enter" });
		expect(h.openSearchRow).toHaveBeenCalledTimes(1);
		expect(h.openSearchRow.mock.calls[0][0].session.id).toBe("s-today");
		expect(useSearchDialog.getState().open).toBe(false);
	});

	it("mouse hover highlights a row; click opens it", () => {
		mount();
		type("登录");
		const arch = screen.getByText("归档的登录笔记").closest("[role=option]") as HTMLElement;
		fireEvent.mouseMove(arch);
		expect(selectedOption()).toBe(arch);
		fireEvent.click(arch);
		expect(h.openSearchRow.mock.calls[0][0].session.id).toBe("s-arch");
	});

	it("ignores ↑↓/Enter while an IME composition is active", () => {
		mount();
		type("登录");
		fireEvent.keyDown(input(), { key: "ArrowDown", isComposing: true });
		expect(selectedOption()?.textContent).toContain("今日修复登录");
		fireEvent.keyDown(input(), { key: "Enter", isComposing: true });
		expect(h.openSearchRow).not.toHaveBeenCalled();
		expect(useSearchDialog.getState().open).toBe(true);
	});

	it("Esc closes the dialog and is claimed so nothing else reacts", () => {
		mount();
		const outer = vi.fn();
		window.addEventListener("keydown", outer);
		fireEvent.keyDown(input(), { key: "Escape" });
		window.removeEventListener("keydown", outer);
		expect(useSearchDialog.getState().open).toBe(false);
	});

	it("re-opening (⌘F) while open re-focuses and selects the input", () => {
		mount();
		type("abc");
		(document.activeElement as HTMLElement | null)?.blur();
		act(() => useSearchDialog.getState().openDialog());
		expect(document.activeElement).toBe(input());
	});
});

describe("index status", () => {
	it("shows a non-blocking notice while the index builds and hides it when done", async () => {
		h.searchIndexStatus.mockResolvedValue({ indexed: 3, total: 10, building: true });
		mount();
		await waitFor(() =>
			expect(screen.getByText("正在建立全文索引 3/10，结果可能不完整")).toBeTruthy(),
		);
		// still usable
		type("登录");
		expect(options().length).toBeGreaterThan(0);

		act(() => h.progress.cb?.({ indexed: 7, total: 10, building: true }));
		expect(screen.getByText("正在建立全文索引 7/10，结果可能不完整")).toBeTruthy();
		act(() => h.progress.cb?.({ indexed: 10, total: 10, building: false }));
		expect(screen.queryByText(/正在建立全文索引/)).toBeNull();
	});
});

describe("包含已归档", () => {
	it("is on by default and toggling it off hides archived sessions", () => {
		mount();
		const chip = screen.getByRole("button", { name: "已包含已归档" });
		expect(chip.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByText("归档的登录笔记")).toBeTruthy();
		fireEvent.click(chip);
		expect(chip.getAttribute("aria-pressed")).toBe("false");
		expect(screen.getByRole("button", { name: "未包含已归档" })).toBe(chip);
		expect(screen.queryByText("归档的登录笔记")).toBeNull();
		type("登录");
		expect(screen.queryByText("归档的登录笔记")).toBeNull();
	});
});
