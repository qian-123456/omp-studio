import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { useArchiveUndo, archiveSessions, undoArchive } from "./archiveUndo";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
vi.mock("../../lib/ipc", () => ({
	updateSessionMeta: vi.fn(async (id: string, patch: Partial<SessionMeta>) => {
		const existing = useSessions.getState().sessions[id] ?? {};
		return { ...existing, id, ...patch } as SessionMeta;
	}),
}));

function makeSession(partial: Partial<SessionMeta>): SessionMeta {
	return {
		id: partial.id || "test-id",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: partial.cwd || "/repo/my-proj",
		title: partial.title || "Test Session",
		label: partial.label || "#1",
		createdAt: partial.createdAt || "2026-09-28T12:00:00Z",
		updatedAt: partial.updatedAt || "2026-09-28T12:00:00Z",
		archived: partial.archived || false,
		pinned: partial.pinned || false,
		workspaceId: partial.workspaceId ?? null,
		parentId: partial.parentId || null,
		forkDepth: partial.forkDepth || 0,
		status: partial.status || "idle",
		unread: partial.unread || false,
		pending: partial.pending ?? null,
		live: partial.live || false,
		externalPid: partial.externalPid ?? null,
		repoRoot: partial.repoRoot ?? null,
		git: partial.git ?? null,
		result: partial.result ?? null,
		lastAssistant: partial.lastAssistant ?? null,
		model: partial.model ?? null,
		attention: null,
		mode: partial.mode ?? "code",
		groupId: partial.groupId ?? null,
		...partial,
	};
}

describe("archiveUndo logic (Q10, C10, C15)", () => {
	beforeEach(() => {
		useArchiveUndo.getState().clear();
		useSessions.setState({
			sessions: {},
			workspaces: [],
		});
		useUi.setState({
			selectedSessionId: null,
			selectedIds: new Set(),
		});
	});

	it("merges consecutive archives into '已归档 N 个会话' (Q10)", () => {
		useArchiveUndo.getState().show({
			sessionIds: ["sess-1"],
			title: "已归档「会话一」",
			previousSelectedSessionId: "sess-1",
			autoSelectedNeighborId: "sess-2",
		});

		expect(useArchiveUndo.getState().item?.title).toBe("已归档「会话一」");
		expect(useArchiveUndo.getState().item?.sessionIds).toEqual(["sess-1"]);

		// Second archive arrives within the undo window
		useArchiveUndo.getState().show({
			sessionIds: ["sess-2"],
			title: "已归档「会话二」",
			previousSelectedSessionId: "sess-2",
			autoSelectedNeighborId: "sess-3",
		});

		const merged = useArchiveUndo.getState().item;
		expect(merged).not.toBeNull();
		expect(merged?.title).toBe("已归档 2 个会话");
		expect(merged?.sessionIds).toEqual(["sess-1", "sess-2"]);
		expect(merged?.previousSelectedSessionId).toBe("sess-1");
		expect(merged?.autoSelectedNeighborId).toBe("sess-3");
	});

	it("restores selection only if current selectedSessionId is autoSelectedNeighbor or null (C10)", async () => {
		const s1 = makeSession({ id: "s1", title: "Session 1", archived: true });
		useSessions.setState({
			sessions: { s1 },
		});

		// Case A: user stayed on the auto-selected neighbor
		useUi.setState({ selectedSessionId: "neighbor-b" });
		useArchiveUndo.getState().show({
			sessionIds: ["s1"],
			title: "已归档「Session 1」",
			previousSelectedSessionId: "s1",
			autoSelectedNeighborId: "neighbor-b",
		});

		await undoArchive();
		expect(useUi.getState().selectedSessionId).toBe("s1");

		// Case B: user moved to another session before clicking undo
		useArchiveUndo.getState().show({
			sessionIds: ["s1"],
			title: "已归档「Session 1」",
			previousSelectedSessionId: "s1",
			autoSelectedNeighborId: "neighbor-b",
		});
		useUi.setState({ selectedSessionId: "other-c" });

		await undoArchive();
		// Should remain on other-c without hijacking
		expect(useUi.getState().selectedSessionId).toBe("other-c");
	});

	it("single-success undo label uses sessionDisplayName and ignores batch opts.title (C15)", async () => {
		const s1 = makeSession({ id: "s1", title: "Single Session" });
		useSessions.setState({
			sessions: { s1 },
		});

		await archiveSessions(["s1"], { title: "批量归档 (3)" });

		const item = useArchiveUndo.getState().item;
		expect(item?.title).toBe("已归档「Single Session」");
	});
});
