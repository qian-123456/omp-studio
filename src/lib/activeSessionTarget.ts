export interface ActiveSessionTarget {
	source: "draft" | "session" | "none";
	sessionId: string | null;
	cwd: string | null;
	workspaceId: string | null;
}

/** Resolve the visible draft before the selected persisted session; never use a previous session. */
export function resolveActiveSessionTarget(args: {
	selectedSessionId: string | null;
	selectedDraftId: string | null;
	drafts: Record<string, { opts: { cwd: string; workspaceId?: string | null }; sessionId: string | null }>;
	sessions: Record<string, { cwd: string; workspaceId: string | null }>;
}): ActiveSessionTarget {
	const draft = args.selectedDraftId ? args.drafts[args.selectedDraftId] : undefined;
	if (draft) return { source: "draft", sessionId: draft.sessionId, cwd: draft.opts.cwd || null, workspaceId: draft.opts.workspaceId ?? null };
	const session = args.selectedSessionId ? args.sessions[args.selectedSessionId] : undefined;
	if (session) return { source: "session", sessionId: args.selectedSessionId, cwd: session.cwd || null, workspaceId: session.workspaceId };
	return { source: "none", sessionId: null, cwd: null, workspaceId: null };
}
