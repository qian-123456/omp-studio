/** Typeable placeholder shown while a new session's omp process is still starting.
 * Mirrors the empty-session layout (greeting + centered composer card) so the
 * hand-off to the real session view does not visually jump. */

import { useEffect, useRef } from "react";
import { ArrowUp, Folder, Loader2 } from "lucide-react";
import { StartGlow, StartHero } from "../../components/StartHero";
import { usePendingSession } from "./pendingSession";

function baseName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export function PendingSessionView() {
	const pending = usePendingSession((s) => s.pending);
	const setText = usePendingSession((s) => s.setText);
	const submit = usePendingSession((s) => s.submit);
	const ref = useRef<HTMLTextAreaElement>(null);
	const submitted = pending?.submit === true;

	useEffect(() => {
		ref.current?.focus();
	}, [pending?.token]);

	if (!pending) return null;
	const canSend = pending.text.trim().length > 0 && !submitted;

	return (
		<div className="relative @container flex h-full flex-col justify-center pb-[6vh]">
			<StartGlow />
			<StartHero />
			<div className="start-rise mx-auto w-full max-w-[880px] px-6">
				<div className="relative rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] shadow-sm">
					<div className="flex items-center gap-1 px-3 pt-2.5">
						<span
							title={pending.cwd}
							className="flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium text-[var(--text-80,var(--text))] select-none"
						>
							<Folder size={13} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
							<span className="truncate">{baseName(pending.cwd)}</span>
						</span>
					</div>
					<textarea
						ref={ref}
						value={pending.text}
						disabled={submitted}
						rows={3}
						placeholder="描述你的任务，会话准备好后自动接上"
						aria-label="新会话输入框"
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								submit();
							}
						}}
						className="block w-full resize-none bg-transparent px-4 pt-2 pb-1 text-[14px] leading-[1.6] text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))] disabled:opacity-60"
					/>
					<div className="flex items-center justify-between gap-2 px-3 pb-2.5">
						<span className="flex items-center gap-1.5 text-[12px] text-[var(--text-40,var(--text-dim))]">
							<Loader2 size={12} className="animate-spin" />
							{submitted ? "启动后自动发送" : "正在启动会话"}
						</span>
						<button
							type="button"
							aria-label="发送"
							title="会话启动后发送"
							disabled={!canSend}
							onClick={submit}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-25"
						>
							<ArrowUp size={16} />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
