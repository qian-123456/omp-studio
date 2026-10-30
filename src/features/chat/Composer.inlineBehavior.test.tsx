// @vitest-environment jsdom
/**
 * Composer behavior: `/plan` intent coexisting with other chips and surviving failed sends,
 * shared text metrics between textarea and token backdrop, inline image-token click hit testing,
 * and annotation-owned images in the outgoing payload.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type * as DraftSessionModule from "../sessions/draftSession";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { usePendingSession } from "../sessions/pendingSession";
import { Composer } from "./Composer";

const S1 = "inline-s1";
const S2 = "inline-s2";

const h = vi.hoisted(() => ({
	imageContents: vi.fn(async (_paths: string[]) => [] as Array<{ type: "image"; data: string; mimeType: string }>),
	rpcSend: vi.fn(async (_id: string, _cmd: unknown) => ({}) as Record<string, unknown>),
}));

vi.mock("../../components/ImagePreviewModal", () => ({
	ImagePreviewModal: ({ initialIndex }: { initialIndex: number }) => (
		<div data-testid="preview" data-index={initialIndex} />
	),
}));
vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		imageContentsFromPaths: h.imageContents,
		rpcEnsureLive: vi.fn(async () => ({ sessionId: S1 })),
		ompModelRolesRead: vi.fn(async () => ({
			global: { path: "/g", exists: true, modelRoles: {}, agentModelOverrides: {} },
			project: null,
			agents: [],
		})),
		ompModelRolesSet: vi.fn(async () => ({})),
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		skillsList: vi.fn(async () => ({ skills: [], extensions: [] })),
		listWorkspaceFiles: vi.fn(async () => []),
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		listWorkspaces: vi.fn(async () => []),
		getSettings: vi.fn(async () => null),
		gitBadge: vi.fn(async () => null),
		privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "missing", nativeError: null })),
		privacySessionEntryIds: vi.fn(async () => []),
		mcpConfigList: vi.fn(async () => ({ servers: [] })),
		pluginsList: vi.fn(async () => ({ roots: [], plugins: [] })),
	};
});
vi.mock("../sessions/draftSession", async (importOriginal) => {
	const orig = await importOriginal<typeof DraftSessionModule>();
	return { ...orig, materializeDraft: vi.fn(async () => S1), warmDraft: () => {}, prewarmDraft: async () => S1 };
});
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../lib/events", async (importOriginal) => {
	const orig = await importOriginal<typeof EventsModule>();
	return { ...orig, onPrivacyChanged: async () => () => {} };
});

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	Element.prototype.scrollIntoView = () => {};
	Object.assign(window, { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => `asset://${p}` } });
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const liveFor = (...ids: string[]) =>
	act(() => {
		useLive.setState({
			sessions: Object.fromEntries(
				ids.map((id) => [
					id,
					{
						...emptySessionLive(),
						alive: true,
						state: { model: { provider: "p", id: "m" }, thinkingLevel: "low" },
						plan: { enabled: false, version: 0 },
						commands: [
							{ name: "plan", description: "plan", input: { hint: "<任务>" }, hint: "<任务>" },
							{ name: "skill:grill-me", description: "grill", source: "skill" },
						],
					},
				]),
			) as never,
		});
	});
const prompts = () =>
	h.rpcSend.mock.calls
		.filter(([, c]) => (c as { type: string }).type === "prompt")
		.map(([, c]) => (c as { message: string }).message);
const textarea = (sid: string) => document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${sid}"]`)!;
const type = (ta: HTMLTextAreaElement, value: string) => {
	fireEvent.change(ta, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
};
/** Types `/plan` then the space that turns it into plan intent (the space-detector needs the prior text). */
const typePlanWithSpace = (ta: HTMLTextAreaElement) => {
	type(ta, "/plan");
	type(ta, "/plan ");
};
// 1x1 transparent PNG.
const PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PILL = "点击关闭规划模式";

beforeEach(() => {
	localStorage.clear();
	h.imageContents.mockReset();
	h.imageContents.mockImplementation(async () => [{ type: "image", data: PNG_B64, mimeType: "image/png" }]);
	h.rpcSend.mockReset();
	h.rpcSend.mockImplementation(async () => ({}));
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} } as never);
	usePendingSession.setState({ drafts: {}, selectedId: null });
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("/plan intent", () => {
	it("typed /plan leaves no literal, shows the pill and survives a session round-trip", async () => {
		liveFor(S1, S2);
		const view = render(<Composer sessionId={S1} />);
		await flush();
		typePlanWithSpace(textarea(S1));
		await flush();
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();
		expect(textarea(S1).value).toBe("");

		view.rerender(<Composer sessionId={S2} />);
		await flush();
		expect(document.querySelector(`[title="${PILL}"]`)).toBeNull();
		view.rerender(<Composer sessionId={S1} />);
		await flush();
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();
	});

	const pickOption = async (sid: string, query: string, label: string) => {
		type(textarea(sid), query);
		await flush();
		const opt = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) =>
			(o.textContent ?? "").startsWith(label),
		);
		expect(opt).toBeTruthy();
		fireEvent.mouseDown(opt!);
		await flush();
	};

	it("menu: /plan then /skill keeps both", async () => {
		liveFor(S1);
		render(<Composer sessionId={S1} />);
		await flush();
		await pickOption(S1, "/plan", "/plan");
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();
		await pickOption(S1, "/skill:grill", "/skill:grill-me");
		expect(textarea(S1).value).toContain("/skill:grill-me");
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();
	});

	it("menu: /skill then /plan keeps both and leaves no /plan literal", async () => {
		liveFor(S1);
		render(<Composer sessionId={S1} />);
		await flush();
		await pickOption(S1, "/skill:grill", "/skill:grill-me");
		const withSkill = textarea(S1).value;
		expect(withSkill).toContain("/skill:grill-me");
		await pickOption(S1, `${withSkill}/plan`, "/plan");
		expect(textarea(S1).value).toContain("/skill:grill-me");
		expect(textarea(S1).value).not.toContain("/plan");
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();
	});

	it("a failed enable keeps the draft and the pending intent; a retry then enables and sends", async () => {
		liveFor(S1);
		render(<Composer sessionId={S1} />);
		await flush();
		typePlanWithSpace(textarea(S1));
		await flush();
		type(textarea(S1), "hello");
		h.rpcSend.mockImplementation(async (_id, cmd) => {
			if ((cmd as { message?: string }).message === "/plan-action enable") throw new Error("boom");
			return {};
		});
		fireEvent.keyDown(textarea(S1), { key: "Enter" });
		await flush();
		expect(prompts()).not.toContain("hello");
		expect(textarea(S1).value).toBe("hello");
		expect(document.querySelector(`[title="${PILL}"]`)).not.toBeNull();

		h.rpcSend.mockImplementation(async () => ({}));
		fireEvent.keyDown(textarea(S1), { key: "Enter" });
		await flush();
		expect(prompts().slice(-2)).toEqual(["/plan-action enable", "hello"]);
	});
});

describe("inline image token", () => {
	const setup = async () => {
		liveFor(S1);
		useComposer.setState({
			drafts: { [S1]: "x 🖼️#1 y" },
			images: { [S1]: [{ id: "i1", path: "/tmp/a.png" }] },
		} as never);
		render(<Composer sessionId={S1} />);
		await flush();
		return textarea(S1);
	};
	const token = () => screen.queryByRole("button", { name: /🖼️#1$/u });

	it("is a real accessible control that opens the preview when activated", async () => {
		await setup();
		expect(token()).not.toBeNull();
		expect(token()!.closest('[aria-hidden="true"]')).toBeNull();
		fireEvent.click(token()!);
		expect(document.querySelector("[data-testid='preview']")?.getAttribute("data-index")).toBe("0");
	});

	it("is keyboard-focusable and Enter/Space on the focused token opens the preview without sending", async () => {
		const ta = await setup();
		const tok = token()!;
		expect(tok.tabIndex).toBe(0);
		tok.focus();
		expect(document.activeElement).toBe(tok);
		fireEvent.keyDown(tok, { key: "ArrowRight" });
		expect(document.querySelector("[data-testid='preview']")).toBeNull();
		fireEvent.keyDown(tok, { key: " " });
		expect(document.querySelector("[data-testid='preview']")?.getAttribute("data-index")).toBe("0");
		expect(prompts()).toEqual([]);
		expect(ta.value).toBe("x 🖼️#1 y");
	});

	it("Enter in the textarea next to the token sends normally and never previews", async () => {
		const ta = await setup();
		ta.focus();
		ta.setSelectionRange(1, 1);
		fireEvent.keyDown(ta, { key: "Enter" });
		await flush();
		expect(document.querySelector("[data-testid='preview']")).toBeNull();
	});

	it("does not steal focus or move the caret on press", async () => {
		const ta = await setup();
		ta.focus();
		ta.setSelectionRange(1, 1);
		expect(fireEvent.mouseDown(token()!)).toBe(false); // default prevented
		expect(document.activeElement).toBe(ta);
		expect(ta.selectionStart).toBe(1);
	});

	it("ordinary text and arrow keys never open the preview", async () => {
		const ta = await setup();
		fireEvent.click(ta);
		ta.setSelectionRange(5, 5);
		fireEvent.keyDown(ta, { key: "ArrowRight" });
		fireEvent.keyUp(ta, { key: "ArrowRight" });
		expect(document.querySelector("[data-testid='preview']")).toBeNull();
	});

	it("tokens without an attached image are not controls", async () => {
		liveFor(S1);
		useComposer.setState({ drafts: { [S1]: "x 🖼️#2 y" }, images: { [S1]: [{ id: "i1", path: "/tmp/a.png" }] } } as never);
		render(<Composer sessionId={S1} />);
		await flush();
		expect(screen.queryByRole("button", { name: /🖼️#2$/u })).toBeNull();
	});
});

describe("annotation images in the outgoing payload", () => {
	it("sends annotation-owned images as attachments without touching the main images", async () => {
		liveFor(S1);
		useComposer.setState({
			drafts: { [S1]: "see this" },
			annotations: { [S1]: [{ id: "a1", source: "chat", text: "quote", images: ["/tmp/ann.png"] }] },
		} as never);
		render(<Composer sessionId={S1} />);
		await flush();
		fireEvent.keyDown(textarea(S1), { key: "Enter" });
		await flush();
		expect(h.imageContents).toHaveBeenCalledWith(["/tmp/ann.png"]);
		const message = prompts()[0];
		const sent = h.rpcSend.mock.calls.find(([, c]) => (c as { type: string }).type === "prompt")?.[1] as {
			images?: Array<{ type: string; data: string; mimeType: string }>;
		};
		expect(sent.images).toEqual([{ type: "image", data: PNG_B64, mimeType: "image/png" }]);
		expect(message).toContain("[图片: /tmp/ann.png]");
		// The optimistic echo carries the annotation image exactly once (deduped against the text reference).
		const echo = useLive.getState().sessions[S1]?.pendingUserEchoes[0];
		expect(echo?.images?.filter((i) => i.path === "/tmp/ann.png")).toHaveLength(1);
		expect(useComposer.getState().images[S1] ?? []).toEqual([]);
	});

	it("an unreadable image fails the whole send: no prompt RPC, draft and annotation restored", async () => {
		liveFor(S1);
		h.imageContents.mockRejectedValue("无法读取图片 /tmp/ann.png：No such file");
		useComposer.setState({
			drafts: { [S1]: "see this" },
			annotations: { [S1]: [{ id: "a1", source: "chat", text: "quote", images: ["/tmp/ann.png"] }] },
		} as never);
		render(<Composer sessionId={S1} />);
		await flush();
		fireEvent.keyDown(textarea(S1), { key: "Enter" });
		await flush();
		expect(prompts()).toEqual([]);
		expect(textarea(S1).value).toBe("see this");
		expect(useComposer.getState().annotations[S1]).toHaveLength(1);
		expect(useLive.getState().sessions[S1]?.pendingUserEchoes ?? []).toEqual([]);
	});

	it("sends main and annotation images together, one native block per distinct path", async () => {
		liveFor(S1);
		h.imageContents.mockImplementation(async (paths: string[]) =>
			paths.map(() => ({ type: "image" as const, data: PNG_B64, mimeType: "image/png" })),
		);
		useComposer.setState({
			drafts: { [S1]: "look 🖼️#1" },
			images: { [S1]: [{ id: "i1", path: "/tmp/main.png" }] },
			annotations: {
				[S1]: [{ id: "a1", source: "chat", text: "quote", images: ["/tmp/ann.png", "/tmp/main.png"] }],
			},
		} as never);
		render(<Composer sessionId={S1} />);
		await flush();
		fireEvent.keyDown(textarea(S1), { key: "Enter" });
		await flush();
		expect(h.imageContents).toHaveBeenCalledWith(["/tmp/main.png", "/tmp/ann.png"]);
		const sent = h.rpcSend.mock.calls.find(([, c]) => (c as { type: string }).type === "prompt")?.[1] as {
			images?: unknown[];
		};
		expect(sent.images).toHaveLength(2);
	});
});
