/** Main-area draft of a lazy fork: shows the parent transcript read-only and an
 * empty, focused composer. Nothing exists on the backend until the first send
 * (see `forkDraft.ts`). The notice lives OUTSIDE the composer. */

import { useEffect, useRef, useState } from "react";
import { errMsg } from "../../lib/dialogs";
import { getTranscript } from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { Composer } from "../chat/Composer";
import { MessageList } from "../chat/MessageList";
import { closeForkDraft, cutItemsAtEntry, useForkDraft } from "./forkDraft";

export function ForkDraftView() {
	const draft = useForkDraft((s) => s.draft);
	const parentCwd = useSessions((s) => (draft ? (s.sessions[draft.parentId]?.cwd ?? "") : ""));
	const scrollRef = useRef<HTMLDivElement>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const id = draft?.id;
	const parentId = draft?.parentId;
	const entryId = draft?.entryId ?? null;

	useEffect(() => {
		if (!id || !parentId) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		getTranscript(parentId)
			.then((page) => {
				if (cancelled || useForkDraft.getState().draft?.id !== id) return;
				const items = cutItemsAtEntry(page.items, entryId);
				useForkDraft.getState().setItems(id, items);
				useLive.getState().setItems(id, items, 0);
				setLoading(false);
			})
			.catch((err) => {
				if (cancelled) return;
				setError(errMsg(err));
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [id, parentId, entryId, attempt]);

	useEffect(() => {
		if (id) useComposer.getState().focusComposer(id);
	}, [id]);

	if (!draft) return null;

	return (
		<div className="relative @container flex h-full flex-col">
			<div className="relative min-h-0 flex-1 @container">
				<div ref={scrollRef} className="thread-fade-mask relative h-full overflow-y-auto">
					<MessageList
						sessionId={draft.id}
						scrollRef={scrollRef}
						isLoadingTranscript={loading}
						transcriptError={error}
						onRetryTranscript={() => setAttempt((n) => n + 1)}
						sessionCwd={parentCwd}
					/>
				</div>
			</div>
			<div className="mx-auto w-full @min-[864px]:w-[calc(100%-6rem)] @min-[864px]:max-w-3xl">
				<div className="flex items-center justify-between gap-3 px-5 pb-1 text-[12px] text-[var(--text-40)]">
					<span>
						{draft.sending
							? "正在创建分支…"
							: draft.entryId
								? "发送第一条消息时将从所选回复处创建分支"
								: "发送第一条消息时将从这里创建分支"}
					</span>
					{!draft.sending && (
						<button
							type="button"
							className="rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							onClick={() => {
								const back = draft.parentId;
								closeForkDraft();
								useUi.getState().selectSession(back);
							}}
						>
							放弃分支
						</button>
					)}
				</div>
				<Composer sessionId={draft.id} />
			</div>
		</div>
	);
}
