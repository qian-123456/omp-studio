/** 「将从这里重新开始」banner: shown after the composer while an edit-&-resend
 * draft is active — the session leaf already sits before the target user
 * message, so the next send creates a sibling branch and keeps the old path.
 * Disappears once the resend is sent (a user echo lands) or is cancelled
 * (navigates the leaf back to where it was). */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useLive } from "../../stores/live";
import { tNow } from "../../stores/language";
import { useTree } from "../../stores/tree";
import { navigateTree } from "./treeNav";

export function TreeResendBanner({ sessionId }: { sessionId: string }) {
	const draft = useTree((s) => s.resend[sessionId]);
	const echoCount = useLive(
		(s) => s.sessions[sessionId]?.pendingUserEchoes.length ?? 0,
	);
	const seenEchoes = useRef(echoCount);

	// The resend was sent: the sibling branch now exists, drop the banner.
	useEffect(() => {
		if (echoCount > seenEchoes.current && useTree.getState().resend[sessionId]) {
			useTree.getState().cancelResend(sessionId);
		}
		seenEchoes.current = echoCount;
	}, [echoCount, sessionId]);

	if (!draft) return null;

	const cancel = async () => {
		useTree.getState().cancelResend(sessionId);
		if (draft.prevLeafId) {
			// Walk the leaf back to where it was; on failure the view stays
			// rewound and the banner stays up so the state stays visible.
			const ok = await navigateTree(sessionId, draft.prevLeafId);
			if (ok) return;
			useTree.getState().startResend(sessionId, draft);
		}
	};

	return (
		<div className="mb-1.5 flex items-start gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-3 py-2 text-[12px]">
			<div className="min-w-0 flex-1">
				<div className="font-medium text-[var(--text)]">
					{tNow("chatView.tree.resendTitle")}
				</div>
				<div className="mt-0.5 break-words text-[var(--text-40)]">
					{tNow("chatView.tree.resendHint")}
				</div>
			</div>
			<button
				type="button"
				onClick={() => void cancel()}
				className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--line)] px-2 text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				title={tNow("chatView.tree.resendCancel")}
				aria-label={tNow("chatView.tree.resendCancel")}
			>
				<X size={12} />
				{tNow("chatView.tree.resendCancel")}
			</button>
		</div>
	);
}
