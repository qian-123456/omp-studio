import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TranscriptItem } from "../../../lib/contracts";
import { claimEscape } from "../../../lib/escapeClaim";
import { isComposing } from "../../../lib/hooks";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { computeMatches, visibleFindItems } from "./findCore";
import { useThreadFind } from "./threadFindStore";

const EMPTY: TranscriptItem[] = [];
const BTN =
	"flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:opacity-40";

function focusComposer(sessionId: string): void {
	document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${sessionId}"]`)?.focus();
}

/** Compact find bar pinned to the top-right of the chat area. */
export function ThreadFindBar({ sessionId }: { sessionId: string }) {
	const active = useThreadFind((s) => s.open && s.sessionId === sessionId);
	if (!active) return null;
	return <Bar sessionId={sessionId} />;
}

function Bar({ sessionId }: { sessionId: string }) {
	const rawItems = useLive((s) => s.sessions[sessionId]?.items ?? EMPTY);
	// The message list hides a side chat's inherited parent history; search must
	// count the same visible items or it reports hits that can never be located.
	const isSideChat = useSessions((s) => (s.sessions[sessionId]?.forkDepth ?? 0) > 0);
	const items = useMemo(() => visibleFindItems(rawItems, isSideChat), [rawItems, isSideChat]);
	const query = useThreadFind((s) => s.query);
	const index = useThreadFind((s) => s.index);
	const count = useThreadFind((s) => s.matches.length);
	const focusNonce = useThreadFind((s) => s.focusNonce);
	const inputRef = useRef<HTMLInputElement>(null);
	const composing = useRef(false);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [focusNonce]);

	const matches = useMemo(() => computeMatches(items, query), [items, query]);
	useEffect(() => {
		useThreadFind.getState().setMatches(matches);
	}, [matches]);

	const close = () => {
		useThreadFind.getState().close();
		focusComposer(sessionId);
	};

	const counter = !query ? "" : count === 0 ? "无结果" : `${index + 1} / ${count}`;

	return (
		<div
			data-own-find=""
			className="absolute right-4 top-2 z-30 flex items-center gap-1 rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2 py-1 shadow-apple-modal"
		>
			<input
				ref={inputRef}
				value={query}
				placeholder="在对话中查找"
				aria-label="在对话中查找"
				onChange={(e) => useThreadFind.getState().setQuery(e.target.value)}
				onCompositionStart={() => (composing.current = true)}
				onCompositionEnd={() => (composing.current = false)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						if (composing.current || isComposing(e)) return;
						e.stopPropagation();
						claimEscape(e);
						close();
						return;
					}
					if (composing.current || isComposing(e)) return;
					const st = useThreadFind.getState();
					if (e.key === "Enter") {
						e.preventDefault();
						st.step(e.shiftKey ? -1 : 1);
					} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						st.step(e.key === "ArrowDown" ? 1 : -1);
					}
				}}
				className="w-44 bg-transparent px-1 text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-40)]"
			/>
			<span className="min-w-[3.5rem] whitespace-nowrap text-right text-[12px] tabular-nums text-[var(--text-60)]">
				{counter}
			</span>
			<button
				type="button"
				aria-label="上一个"
				title="上一个 (Shift+Enter)"
				disabled={count === 0}
				onClick={() => useThreadFind.getState().step(-1)}
				className={BTN}
			>
				<ChevronUp size={14} />
			</button>
			<button
				type="button"
				aria-label="下一个"
				title="下一个 (Enter)"
				disabled={count === 0}
				onClick={() => useThreadFind.getState().step(1)}
				className={BTN}
			>
				<ChevronDown size={14} />
			</button>
			<button
				type="button"
				onClick={close}
				className="shrink-0 whitespace-nowrap rounded-md border border-[var(--line)] px-2 py-0.5 text-[12px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
			>
				关闭
			</button>
		</div>
	);
}
