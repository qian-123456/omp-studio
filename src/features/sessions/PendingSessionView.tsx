/** Typeable placeholder shown while a new session's omp process is still starting. */

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { StartGlow } from "../../components/StartHero";
import { usePendingSession } from "./pendingSession";

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

	return (
		<div className="relative @container flex h-full flex-col justify-center pb-[6vh]">
			<StartGlow />
			<div className="mx-auto w-full max-w-[880px] px-6">
				<div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] p-3 shadow-sm">
					<textarea
						ref={ref}
						value={pending.text}
						disabled={submitted}
						rows={4}
						placeholder="直接输入你的任务，会话准备好后会自动接上"
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
						className="w-full resize-none bg-transparent text-[14px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-40)] disabled:opacity-60"
					/>
					<div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-40)]">
						<Loader2 size={12} className="animate-spin" />
						{submitted ? "会话启动后自动发送" : "会话启动中，可以先输入"}
					</div>
				</div>
			</div>
		</div>
	);
}
