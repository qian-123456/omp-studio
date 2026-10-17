/**
 * Optimistic new-session flow. Starting an omp RPC process takes seconds, so the
 * center pane shows a typeable placeholder immediately; once the real session
 * exists the typed text moves into its composer (or is sent, if the user already
 * pressed Enter) and the real session view takes over.
 */

import { create } from "zustand";
import { createSession, type CreateSessionOpts } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { sendPrompt } from "../chat/send";

export interface PendingSession {
	/** Identity of this attempt; a newer attempt or a cancel invalidates older ones. */
	token: number;
	cwd: string;
	text: string;
	/** User pressed Enter: send the text as soon as the session is ready. */
	submit: boolean;
}

interface PendingState {
	pending: PendingSession | null;
	setText(text: string): void;
	submit(): void;
}

export const usePendingSession = create<PendingState>((set) => ({
	pending: null,
	setText: (text) =>
		set((s) => (s.pending ? { pending: { ...s.pending, text } } : s)),
	submit: () =>
		set((s) =>
			s.pending && s.pending.text.trim()
				? { pending: { ...s.pending, submit: true } }
				: s,
		),
}));

let nextToken = 1;

/** True while the placeholder is the visible center view. */
function placeholderVisible(token: number): boolean {
	const ui = useUi.getState();
	return (
		usePendingSession.getState().pending?.token === token &&
		ui.selectedSessionId === null &&
		ui.centerView === "session"
	);
}

/**
 * Show the placeholder now, create the session in the background.
 * Resolves when creation finished (or failed); errors are toasted here.
 */
export async function startSessionOptimistic(
	opts: CreateSessionOpts,
): Promise<void> {
	const token = nextToken++;
	usePendingSession.setState({
		pending: { token, cwd: opts.cwd, text: "", submit: false },
	});
	// `selectSession(null)` would bounce to the home view; the placeholder lives
	// in the session pane with no session selected.
	useUi.setState({ selectedSessionId: null, centerView: "session" });

	try {
		const { sessionId, stub } = await createSession(opts);
		useSessions.getState().upsert([stub]);
		const pending = usePendingSession.getState().pending;
		const mine = pending?.token === token ? pending : null;
		const visible = placeholderVisible(token);
		if (mine) usePendingSession.setState({ pending: null });
		const text = mine?.text ?? "";
		if (visible) useUi.getState().selectSession(sessionId);
		if (mine?.submit && text.trim() && !text.trimStart().startsWith("/")) {
			void sendPrompt(sessionId, text.trim()).catch((err) => {
				useComposer.getState().setDraft(sessionId, text);
				toast.error(`发送失败: ${errMsg(err)}`);
			});
			return;
		}
		if (text) useComposer.getState().setDraft(sessionId, text);
		if (visible) useComposer.getState().focusComposer(sessionId);
	} catch (err) {
		const visible = placeholderVisible(token);
		if (usePendingSession.getState().pending?.token === token) {
			usePendingSession.setState({ pending: null });
		}
		if (visible) useUi.getState().selectSession(null);
		toast.error(`创建会话失败: ${errMsg(err)}`);
	}
}
