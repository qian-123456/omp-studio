// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../core/api";
import { useConnection } from "../../core/stores/connection";
import { useSessions } from "../../core/stores/sessions";
import { DialogHost } from "../../ui/Dialog";
import { ChatController } from "./chatStore";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const session = { id: "s1", status: "awaiting_approval", pending: "approval", cwd: "/project", live: true };
const approval = (id: string) => ({ request: { id, method: "confirm", title: `Allow ${id}` } });

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
	useConnection.setState({ phase: "idle", error: null });
	useSessions.setState({ list: [session], byId: { s1: session }, loaded: true, loading: false } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("mobile prompt delivery contract", () => {
	it("accepted prompt with lost response is unknown, survives reload and never blindly resends", async () => {
		const received: string[] = [];
		vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
			if (String(url).endsWith("/prompt-ex")) {
				received.push(JSON.parse(String(init.body)).text);
				return new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
			}
			return Promise.resolve(json([]));
		}));
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "", set };
		c.store.setState({ atts: [{ id: 1, name: "notes.txt", isImage: false, status: "ok", path: "/uploads/notes.txt", url: "" }] });
		const first = c.send("deploy", "steer");
		await vi.advanceTimersByTimeAsync(30_000);
		await first;
		expect(set).toHaveBeenLastCalledWith("");
		expect(c.state.delivery).toMatchObject({ phase: "unknown", text: "deploy", atts: [{ path: "/uploads/notes.txt" }] });
		expect(await c.send("deploy!", "steer")).toBe(false);
		const reload = new ChatController("s1");
		expect(reload.state.delivery).toMatchObject({ phase: "unknown", text: "deploy" });
		expect(await reload.send("deploy", "steer")).toBe(false);
		expect(new ChatController("s2").state.delivery).toBeNull();
		expect(received).toHaveLength(1);
	});

	it("persists before dispatch and retains the original draft when storage fails", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); });
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "not sent", set };
		expect(await c.send("not sent", "steer")).toBe(false);
		expect(fetch).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(c.state.delivery).toBeNull();
	});

	it("cancel keeps the guard; explicit risk-confirmed recovery restores text and attachments without sending", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new ApiError(502, "response lost")));
		const c = new ChatController("s1");
		const set = vi.fn();
		c.composer = { get: () => "new draft", set };
		c.store.setState({ atts: [{ id: 1, name: "a.png", isImage: true, status: "ok", path: "/uploads/a.png", url: "" }] });
		await c.send("original", "steer");
		render(<DialogHost />);
		let recovery!: Promise<void>;
		act(() => { recovery = c.resolveDelivery(true); });
		fireEvent.click(screen.getByText("取消"));
		await act(async () => recovery);
		expect(c.state.delivery?.phase).toBe("unknown");
		expect(new ChatController("s1").state.delivery?.phase).toBe("unknown");
		act(() => { recovery = c.resolveDelivery(true); });
		fireEvent.click(screen.getByText("知晓风险，恢复输入"));
		await act(async () => recovery);
		expect(set).toHaveBeenLastCalledWith("original\nnew draft");
		expect(c.state.atts[0].path).toBe("/uploads/a.png");
		expect(c.state.delivery).toBeNull();
		expect(new ChatController("s1").state.delivery).toMatchObject({ phase: "unknown", atts: [{ path: "/uploads/a.png" }] });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("a reload during an in-flight request is ambiguous too, while success clears only its session", async () => {
		let done!: (v: Response) => void;
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { done = resolve; })));
		const c = new ChatController("s1");
		const sent = c.send("hello", "steer");
		expect(new ChatController("s1").state.delivery?.phase).toBe("unknown");
		expect(await c.send("double tap", "steer")).toBe(false);
		done(json({ ok: true }));
		await sent;
		expect(c.state.delivery).toBeNull();
		expect(new ChatController("s1").state.delivery).toBeNull();
	});

	it("does not call an HTTP rejection proof of non-delivery", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "upstream rejected after dispatch" }), { status: 400, headers: { "content-type": "application/json" } })));
		const c = new ChatController("s1");
		await c.send("maybe accepted", "steer");
		expect(c.state.delivery).toMatchObject({ phase: "unknown", text: "maybe accepted" });
		expect(await c.send("changed text", "steer")).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("leaving the page while confirmation is open cannot clear the saved uncertainty", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		const c = new ChatController("s1");
		await c.send("keep this", "steer");
		render(<DialogHost />);
		let recovery!: Promise<void>;
		act(() => { recovery = c.resolveDelivery(false); });
		c.dispose();
		fireEvent.click(screen.getByText("已核对，继续"));
		await act(async () => recovery);
		expect(new ChatController("s1").state.delivery).toMatchObject({ phase: "unknown", text: "keep this" });
	});

	it("does not downgrade an acknowledged prompt when local record cleanup fails", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true })));
		vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage unavailable"); });
		const c = new ChatController("s1");
		await c.send("acknowledged", "steer");
		expect(c.state.delivery).toBeNull();
		expect(c.state.optimistic).toHaveLength(1);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe("mobile pending snapshot ownership", () => {
	it("rejects an older snapshot arriving after a newer one", async () => {
		const resolves: Array<(r: Response) => void> = [];
		vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => resolves.push(resolve))));
		const c = new ChatController("s1");
		const old = c.loadPendings();
		const fresh = c.loadPendings();
		resolves[1](json([approval("new")]));
		await fresh;
		resolves[0](json([approval("old")]));
		await old;
		expect(c.state.pendings.map((p) => p.request?.id)).toEqual(["new"]);
	});

	it("a response acknowledgement tombstones its card across stale snapshots", async () => {
		let old!: (r: Response) => void;
		let reads = 0;
		vi.stubGlobal("fetch", vi.fn((url: string) => {
			if (String(url).endsWith("/pending-ui")) {
				if (++reads === 1) return new Promise<Response>((resolve) => { old = resolve; });
				return Promise.resolve(json([approval("seen"), approval("new")]));
			}
			if (String(url).endsWith("/sessions")) return Promise.resolve(json([session]));
			return Promise.resolve(json({ ok: true }));
		}));
		const c = new ChatController("s1");
		c.store.setState({ pendings: [approval("seen")] });
		const stale = c.loadPendings();
		await c.respond(approval("seen"), { confirmed: true });
		old(json([approval("seen")]));
		await stale;
		expect(c.state.pendings.map((p) => p.request?.id)).toEqual(["new"]);
	});

	it("batch carries only IDs from the rendered cards and tombstones acknowledged IDs", async () => {
		const bodies: unknown[] = [];
		vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
			if (String(url).endsWith("/ui-respond-all")) {
				bodies.push(JSON.parse(String(init.body)));
				return json({ handled: 2, skipped: 0, handledIds: ["a", "b"] });
			}
			if (String(url).endsWith("/sessions")) return json([session]);
			return json([approval("a"), approval("b"), approval("unseen")]);
		}));
		const c = new ChatController("s1");
		const rendered = [approval("a"), approval("b")];
		c.store.setState({ pendings: [...rendered, approval("unseen")] });
		await c.approveAll("approve", rendered);
		expect(bodies).toEqual([{ action: "approve", ids: ["a", "b"] }]);
		expect(c.state.pendings.map((p) => p.request?.id)).toEqual(["unseen"]);
	});

	it("a new arrival reusing a request ID is not hidden by the old arrival's tombstone", async () => {
		const old = { ...approval("same"), receivedAt: "2026-10-29T00:00:00Z" };
		const fresh = { ...approval("same"), receivedAt: "2026-10-29T00:01:00Z" };
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			if (String(url).endsWith("/sessions")) return json([session]);
			if (String(url).endsWith("/pending-ui")) return json([old, fresh]);
			return json({ ok: true });
		}));
		const c = new ChatController("s1");
		c.store.setState({ pendings: [old] });
		await c.respond(old, { confirmed: true });
		expect(c.state.pendings).toEqual([fresh]);
	});
});
