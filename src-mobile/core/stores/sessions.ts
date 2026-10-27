import { create } from "zustand";
import { api } from "../api";
import { events } from "../sse";
import { isDraftId, type MobileSession, type SpaceMode } from "../types";
export interface CreateSessionInput {
	cwd: string;
	model?: { provider: string; modelId: string };
	thinking?: string;
	mode?: SpaceMode;
}

/** `POST /left/sessions` → `LiveSessionInfo` (a process-free draft id for new sessions). */
interface CreateResponse {
	sessionId?: string;
	session?: { id?: string };
	mode?: SpaceMode;
	cwd?: string;
}

export interface CreatedSession {
	id: string;
	mode: SpaceMode;
	cwd: string;
}

interface SessionsState {
	list: MobileSession[];
	byId: Record<string, MobileSession>;
	loaded: boolean;
	loading: boolean;
	refresh: () => Promise<MobileSession[]>;
	/** Merge a partial row (e.g. a PATCH response) into the store without refetching. */
	patch: (id: string, patch: Partial<MobileSession>) => void;
	createSession: (input: CreateSessionInput) => Promise<CreatedSession>;
}

const index = (list: MobileSession[]): Record<string, MobileSession> => {
	const byId: Record<string, MobileSession> = {};
	for (const s of list) byId[s.id] = s;
	return byId;
};

let inflight: Promise<MobileSession[]> | null = null;

export const useSessions = create<SessionsState>((set, get) => ({
	list: [],
	byId: {},
	loaded: false,
	loading: false,
	/** Concurrent callers share one request. Keeps fields merged by `patch` that the flat list does not carry. */
	refresh: () => {
		if (inflight) return inflight;
		set({ loading: true });
		inflight = api<MobileSession[]>("GET", "/sessions")
			.then((rows) => {
				const prev = get().byId;
				const drafts = Object.values(prev).filter((s) => isDraftId(s.id));
				const list = [
					...drafts,
					...(Array.isArray(rows) ? rows : []).map((r) => (prev[r.id] ? { ...prev[r.id], ...r } : r)),
				];
				set({ list, byId: index(list), loaded: true, loading: false });
				return list;
			})
			.catch((e) => {
				set({ loading: false });
				throw e;
			})
			.finally(() => {
				inflight = null;
			});
		return inflight;
	},
	patch: (id, patch) => {
		const cur = get().byId[id];
		if (!cur) return;
		const next = { ...cur, ...patch };
		set((s) => ({ list: s.list.map((x) => (x.id === id ? next : x)), byId: { ...s.byId, [id]: next } }));
	},
	createSession: async ({ cwd, model, thinking, mode }) => {
		const body: Record<string, unknown> = { cwd };
		if (model) body.model = model;
		if (thinking) body.thinking = thinking;
		if (mode) body.mode = mode;
		const res = await api<CreateResponse>("POST", "/left/sessions", body);
		const id = res?.sessionId || res?.session?.id;
		if (!id) throw new Error("创建会话失败：服务器未返回会话 id");
		const draftSession: MobileSession = {
			id,
			label: "新会话",
			title: "新会话",
			status: "idle",
			updatedAt: new Date().toISOString(),
			cwd: res.cwd ?? cwd,
			live: false,
			mode: res.mode ?? mode ?? "code",
		};
		set((s) => ({
			list: [draftSession, ...s.list.filter((x) => x.id !== id)],
			byId: { ...s.byId, [id]: draftSession },
		}));
		// Refresh in the background: the row (draft or real) shows up in lists without blocking navigation.
		void get().refresh().catch(() => {});
		return { id, mode: res.mode ?? mode ?? "code", cwd: res.cwd ?? cwd };
	},
}));

/**
 * Keep the store fresh from SSE: `hello`/`resync`/`session` refetch the flat list (coalesced to one in-flight
 * request); a `session` event also patches the status instantly so badges flip before the refetch lands.
 */
export function startSessionsSync(): () => void {
	const refresh = () => void useSessions.getState().refresh().catch(() => {});
	const offs = [
		events.on("hello", refresh),
		events.on("resync", refresh),
		events.on("session", (e) => {
			if (e.new) useSessions.getState().patch(e.sessionId, { status: e.new as MobileSession["status"] });
			refresh();
		}),
	];
	return () => offs.forEach((off) => off());
}

/** Selector helper: one session row by id (stable reference while unchanged). */
export const useSession = (id: string | null | undefined): MobileSession | undefined =>
	useSessions((s) => (id ? s.byId[id] : undefined));
