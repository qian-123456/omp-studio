import type { SessionMeta, SessionSearchHit } from "../../../lib/contracts";

export function makeSession(partial: Partial<SessionMeta> & { id: string }): SessionMeta {
	return {
		tool: "omp",
		file: `/tmp/${partial.id}.jsonl`,
		cwd: "/repo",
		title: partial.id,
		label: "",
		createdAt: "2026-10-01T00:00:00Z",
		updatedAt: "2026-10-01T00:00:00Z",
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: "code",
		groupId: null,
		...partial,
	} as SessionMeta;
}

export function makeHit(sessionId: string, extra: Partial<SessionSearchHit> = {}): SessionSearchHit {
	return {
		sessionId,
		entryId: `e-${sessionId}`,
		role: "user",
		ts: "2026-10-01T00:00:00Z",
		segments: [{ text: "needle", hit: true }],
		truncatedStart: false,
		truncatedEnd: false,
		matchCount: 1,
		...extra,
	};
}
