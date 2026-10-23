// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../../lib/contracts";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { archiveSessions, reopenArchivedSession, resetArchivedStack } from "../../sessions/archiveUndo";
import { navBack, navForward, selectAdjacentSession } from "./navigation";

vi.mock("../../../lib/ipc", () => ({
	updateSessionMeta: vi.fn(async (id: string, patch: Partial<SessionMeta>) => {
		const existing = useSessions.getState().sessions[id] ?? {};
		return { ...existing, id, ...patch } as SessionMeta;
	}),
}));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/toast", () => ({
	toast: { info: toastInfo, success: vi.fn(), error: vi.fn() },
}));

const meta = (id: string, extra: Partial<SessionMeta> = {}) =>
	({ id, title: id, archived: false, mode: "code", parentId: null, status: "idle", ...extra }) as SessionMeta;

function seed(...sessions: SessionMeta[]) {
	useSessions.setState({ sessions: Object.fromEntries(sessions.map((s) => [s.id, s])) });
}

beforeEach(() => {
	document.body.innerHTML = "";
	resetArchivedStack();
	toastInfo.mockClear();
	useUi.setState({
		centerView: "home",
		previousCenterView: null,
		selectedSessionId: null,
		lastSessionId: null,
		docPath: null,
		selectedIds: new Set(),
	});
	seed();
});

describe("navBack / navForward", () => {
	it("leaves a full-page view back to the session and forward returns", () => {
		seed(meta("a"));
		useUi.getState().selectSession("a");
		useUi.getState().setCenter("inbox");
		expect(navBack()).toBe(true);
		expect(useUi.getState().centerView).toBe("session");
		expect(navForward()).toBe(true);
		expect(useUi.getState().centerView).toBe("inbox");
		expect(navForward()).toBe(false);
	});

	it("climbs to the side-chat parent only from the session view", () => {
		seed(meta("p"), meta("c", { parentId: "p" }));
		useUi.getState().selectSession("c");
		expect(navBack()).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("p");
		expect(navBack()).toBe(false);
		expect(navForward()).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("c");
	});

	it("discards forward after other navigation", () => {
		seed(meta("p"), meta("c", { parentId: "p" }), meta("x"));
		useUi.getState().selectSession("c");
		navBack();
		useUi.getState().selectSession("x");
		expect(navForward()).toBe(false);
	});

	it("never goes forward to a session that no longer exists", () => {
		seed(meta("p"), meta("c", { parentId: "p" }));
		useUi.getState().selectSession("c");
		navBack();
		seed(meta("p"));
		expect(navForward()).toBe(false);
		expect(useUi.getState().selectedSessionId).toBe("p");
	});

	it("is ignored while settings is open", () => {
		seed(meta("a"));
		useUi.getState().selectSession("a");
		useUi.getState().openSettings();
		expect(navBack()).toBe(false);
	});
});

describe("selectAdjacentSession", () => {
	function renderRows(ids: string[]) {
		const root = document.createElement("div");
		root.setAttribute("data-sidebar-list", "");
		for (const id of ids) {
			const row = document.createElement("div");
			row.dataset.sessionId = id;
			root.appendChild(row);
		}
		document.body.appendChild(root);
	}

	it("moves within visible rows and stops at the ends", () => {
		seed(meta("a"), meta("b"), meta("c"), meta("hidden"));
		renderRows(["a", "b", "c"]);
		useUi.getState().selectSession("b");
		expect(selectAdjacentSession(1)).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("c");
		expect(selectAdjacentSession(1)).toBe(false);
		useUi.getState().selectSession("a");
		expect(selectAdjacentSession(-1)).toBe(false);
		expect(useUi.getState().selectedSessionId).toBe("a");
	});

	it("without a visible selection +1 picks first and -1 last", () => {
		seed(meta("a"), meta("b"), meta("hidden"));
		renderRows(["a", "b"]);
		useUi.getState().selectSession("hidden");
		expect(selectAdjacentSession(1)).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("a");
		useUi.getState().selectSession(null);
		expect(selectAdjacentSession(-1)).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("b");
	});

	it("returns false with no rows", () => {
		expect(selectAdjacentSession(1)).toBe(false);
	});
});

describe("reopenArchivedSession", () => {
	it("restores in reverse archive order, skipping already restored", async () => {
		seed(meta("a"), meta("b"), meta("c"));
		await archiveSessions(["a"]);
		await archiveSessions(["b"]);
		await archiveSessions(["c"]);
		// c restored by other means
		useSessions.getState().upsert([meta("c")]);
		expect(await reopenArchivedSession()).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("b");
		expect(useSessions.getState().sessions.b.archived).toBe(false);
		expect(await reopenArchivedSession()).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe("a");
	});

	it("keeps the archive entry after a failed reopen so it can be retried", async () => {
		seed(meta("a"));
		await archiveSessions(["a"]);
		const { updateSessionMeta } = await import("../../../lib/ipc");
		vi.mocked(updateSessionMeta).mockRejectedValueOnce(new Error("disk error"));
		expect(await reopenArchivedSession()).toBe(false);
		expect(useSessions.getState().sessions.a.archived).toBe(true);
		expect(await reopenArchivedSession()).toBe(true);
		expect(useSessions.getState().sessions.a.archived).toBe(false);
	});

	it("toasts and returns false when empty", async () => {
		expect(await reopenArchivedSession()).toBe(false);
		expect(toastInfo).toHaveBeenCalledWith("没有可恢复的归档会话");
	});
});
