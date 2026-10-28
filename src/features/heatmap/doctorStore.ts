/**
 * AI doctor store: per-session diagnosis state (memory) + diagnosis history
 * (localStorage) + the optional auto scheduler. Only distilled skeleton text
 * is ever sent to the model.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { getTranscript, heatmapDiagnose } from "../../lib/ipc";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../settings/store";
import {
	buildDiagnosisPrompt,
	buildFollowUpPrompt,
	type DoctorHistoryEntry,
	type DoctorTurn,
	parseDiagnosis,
} from "./doctor";
import {
	type DiagnosticDiagnosisResult,
	type DiagnosticLens,
	distillSessionSkeleton,
	type SessionDiagnosticSkeleton,
} from "./distribution";

export interface DoctorSessionState {
	status: "idle" | "running" | "error";
	error: string | null;
	lens: DiagnosticLens;
	result: DiagnosticDiagnosisResult | null;
	thread: DoctorTurn[];
	skeletonTokens: number;
	diagnosedAt: number | null;
}

interface DoctorState {
	bySession: Record<string, DoctorSessionState>;
	history: DoctorHistoryEntry[];
	/** Activity watermark attempted, including failures; auto mode waits for new activity. */
	attemptedActivity: Record<string, number>;
	runDiagnosis: (sessionId: string, lens: DiagnosticLens, question?: string) => Promise<void>;
	askFollowUp: (sessionId: string, question: string) => Promise<void>;
	clear: (sessionId: string) => void;
}

const HISTORY_KEY = "omp.doctor.history";
const ATTEMPTS_KEY = "omp.doctor.attemptedActivity";
const LAST_SCHEDULED_KEY = "omp.doctor.lastScheduledDay";
const HISTORY_CAP = 200;

const EMPTY_SESSION: DoctorSessionState = {
	status: "idle",
	error: null,
	lens: "cost",
	result: null,
	thread: [],
	skeletonTokens: 0,
	diagnosedAt: null,
};

function loadHistory(): DoctorHistoryEntry[] {
	try {
		const raw = localStorage.getItem(HISTORY_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? (parsed as DoctorHistoryEntry[]) : [];
	} catch {
		return [];
	}
}

function loadAttempts(): Record<string, number> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? "{}");
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
	} catch {
		return {};
	}
}

/** Load transcript items for any session (live cache first) and distill them. */
export async function getSkeleton(sessionId: string): Promise<SessionDiagnosticSkeleton> {
	const cached = useLive.getState().sessions[sessionId]?.items;
	const items = cached && cached.length > 0 ? cached : (await getTranscript(sessionId)).items;
	const meta = useSessions.getState().sessions[sessionId];
	return distillSessionSkeleton(items, {
		id: sessionId,
		title: meta?.title,
		model: meta?.model,
		cwd: meta?.cwd,
	});
}

// Skeletons for follow-ups; kept out of zustand state (not rendered).
const skeletonCache: Record<string, SessionDiagnosticSkeleton> = {};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useDoctor = create<DoctorState>((set, get) => {
	const patch = (sessionId: string, p: Partial<DoctorSessionState>) =>
		set((s) => ({
			bySession: {
				...s.bySession,
				[sessionId]: { ...(s.bySession[sessionId] ?? EMPTY_SESSION), ...p },
			},
		}));

	return {
		bySession: {},
		history: loadHistory(),
		attemptedActivity: loadAttempts(),

		async runDiagnosis(sessionId, lens, question) {
			if (get().bySession[sessionId]?.status === "running") return;
			const activity = Date.parse(useSessions.getState().sessions[sessionId]?.updatedAt ?? "");
			if (Number.isFinite(activity)) {
				const attemptedActivity = { ...get().attemptedActivity, [sessionId]: activity };
				set({ attemptedActivity });
				try {
					localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attemptedActivity));
				} catch {
					// Keep the in-memory watermark if storage is unavailable.
				}
			}
			patch(sessionId, { status: "running", error: null, lens });
			try {
				const skeleton = await getSkeleton(sessionId);
				skeletonCache[sessionId] = skeleton;
				const prompt = buildDiagnosisPrompt(skeleton, lens, question);
				const raw = await heatmapDiagnose(prompt, null);
				const result = parseDiagnosis(raw, lens);
				const diagnosedAt = result.generatedAt;
				const thread: DoctorTurn[] = question?.trim()
					? [{ role: "user", text: question.trim(), at: diagnosedAt }]
					: [];
				patch(sessionId, {
					status: "idle",
					result,
					thread,
					skeletonTokens: Math.ceil(skeleton.dehydratedPromptText.length / 2),
					diagnosedAt,
				});
				set((s) => {
					if (s.history.some((h) => h.sessionId === sessionId && h.at === diagnosedAt)) return s;
					const history = [
						...s.history,
						{
							sessionId,
							cwd: skeleton.cwd,
							model: skeleton.model,
							tags: result.systemicTags,
							at: diagnosedAt,
						},
					].slice(-HISTORY_CAP);
					try {
						localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
					} catch {
						// Storage full/unavailable: keep in-memory history.
					}
					return { history };
				});
			} catch (e) {
				patch(sessionId, { status: "error", error: errorText(e) });
			}
		},

		async askFollowUp(sessionId, question) {
			const cur = get().bySession[sessionId];
			const q = question.trim();
			if (!cur?.result || cur.status === "running" || !q) return;
			const userTurn: DoctorTurn = { role: "user", text: q, at: Date.now() };
			patch(sessionId, { status: "running", error: null, thread: [...cur.thread, userTurn] });
			try {
				const skeleton = skeletonCache[sessionId] ?? (await getSkeleton(sessionId));
				skeletonCache[sessionId] = skeleton;
				const raw = await heatmapDiagnose(
					buildFollowUpPrompt(skeleton, cur.result, cur.thread, q),
					null,
				);
				const thread = get().bySession[sessionId]?.thread ?? [userTurn];
				patch(sessionId, {
					status: "idle",
					thread: [...thread, { role: "assistant", text: raw.trim(), at: Date.now() }],
				});
			} catch (e) {
				patch(sessionId, { status: "error", error: errorText(e) });
			}
		},

		clear(sessionId) {
			delete skeletonCache[sessionId];
			set((s) => {
				const { [sessionId]: _, ...rest } = s.bySession;
				return { bySession: rest };
			});
		},
	};
});

/** Last diagnosis time for a session: in-memory state, else persisted history. */
function lastDiagnosedAt(sessionId: string): number {
	const { bySession, history } = useDoctor.getState();
	let at = bySession[sessionId]?.diagnosedAt ?? 0;
	for (const h of history) if (h.sessionId === sessionId && h.at > at) at = h.at;
	return at;
}

/** Sessions whose last activity is before `cutoff`, after `since`, not busy and changed since last diagnosis. */
function pendingSessions(since: number, cutoff: number): string[] {
	const live = useLive.getState().sessions;
	return Object.values(useSessions.getState().sessions)
		.filter((m) => {
			const updated = Date.parse(m.updatedAt);
			if (!Number.isFinite(updated) || updated < since || updated > cutoff) return false;
			if (live[m.id]?.streaming || m.status === "working" || m.attention === "running") return false;
			return updated > lastDiagnosedAt(m.id)
				&& updated > (useDoctor.getState().attemptedActivity[m.id] ?? 0);
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.map((m) => m.id);
}

const anyRunning = () =>
	Object.values(useDoctor.getState().bySession).some((s) => s.status === "running");

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Auto diagnosis (opt-in via settings). Mount once at app root. */
export function useDoctorAutoScheduler(): void {
	const mode = useSettings((s) => s.settings?.doctorAutoMode ?? "manual");
	const idleMinutes = useSettings((s) => s.settings?.doctorIdleMinutes ?? 30);
	const scheduleTime = useSettings((s) => s.settings?.doctorScheduleTime ?? "23:00");

	useEffect(() => {
		if (mode === "manual") return;
		let busy = false;
		const tick = async () => {
			if (busy || anyRunning()) return;
			busy = true;
			try {
				const now = Date.now();
				if (mode === "idle") {
					const [id] = pendingSessions(0, now - idleMinutes * 60_000);
					if (id) await useDoctor.getState().runDiagnosis(id, "cost");
					return;
				}
				const [hh, mm] = scheduleTime.split(":").map(Number);
				const d = new Date(now);
				const due = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0);
				const today = localDay(d);
				if (d < due || localStorage.getItem(LAST_SCHEDULED_KEY) === today) return;
				localStorage.setItem(LAST_SCHEDULED_KEY, today);
				for (const id of pendingSessions(now - 24 * 3_600_000, now).slice(0, 5)) {
					await useDoctor.getState().runDiagnosis(id, "cost");
				}
			} finally {
				busy = false;
			}
		};
		void tick();
		const timer = setInterval(() => void tick(), 60_000);
		return () => clearInterval(timer);
	}, [mode, idleMinutes, scheduleTime]);
}
