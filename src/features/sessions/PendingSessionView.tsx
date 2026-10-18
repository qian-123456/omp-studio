/** Typeable placeholder shown while a new session's omp process is still starting.
 *
 * Geometry mirrors the empty-session layout of `SessionView` + `Composer`
 * (same wrappers, paddings, pill row, textarea and toolbar heights) so the
 * hand-off to the real view does not shift anything the user is looking at.
 * Keep the class lists in sync with `Composer` / `ContextPillBar` / `MessageList`. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Folder, GitBranch, Loader2, Plus } from "lucide-react";
import { StartGlow, StartHero } from "../../components/StartHero";
import { gitBadge } from "../../lib/ipc";
import { usePendingSession } from "./pendingSession";

const PILL =
	"flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium text-[var(--text-80,var(--text))] select-none";

function baseName(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export function PendingSessionView() {
	const pending = usePendingSession((s) => s.pending);
	const setText = usePendingSession((s) => s.setText);
	const submit = usePendingSession((s) => s.submit);
	const ref = useRef<HTMLTextAreaElement>(null);
	const [branch, setBranch] = useState<string | null>(null);
	const submitted = pending?.submit === true;
	const cwd = pending?.cwd ?? "";
	const text = pending?.text ?? "";

	useEffect(() => {
		ref.current?.focus();
	}, [pending?.token]);

	useEffect(() => {
		if (!cwd) return;
		let cancelled = false;
		gitBadge(cwd)
			.then((b) => !cancelled && setBranch(b?.branch ?? null))
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	// Same one-row start and auto-grow as the real composer textarea.
	useLayoutEffect(() => {
		const ta = ref.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
	}, [text]);

	if (!pending) return null;
	const canSend = text.trim().length > 0 && !submitted;

	return (
		<div className="relative @container flex h-full flex-col justify-center pb-[6vh]">
			<StartGlow />
			<StartHero />
			{/* Stands in for MessageList's empty stream list (`pb-8`). */}
			<div aria-hidden className="pb-8" />
			<div className="mx-auto w-full max-w-[880px] px-6">
				<div className="start-rise">
					<div className="shrink-0 px-3 pb-3 pt-1">
						<div className="relative rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] transition-colors duration-150">
							<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-3.5 py-2 text-[var(--text-60,var(--text-muted))]">
								<span title={cwd} className={PILL}>
									<Folder size={14} className="shrink-0 text-neutral-400" />
									<span className="max-w-56 truncate">{baseName(cwd)}</span>
									<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
								</span>
								{branch && (
									<span title={`当前分支: ${branch}`} className={PILL}>
										<GitBranch size={14} className="shrink-0 text-neutral-400" />
										<span className="max-w-56 truncate">{branch}</span>
										<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
									</span>
								)}
							</div>
							<textarea
								ref={ref}
								value={text}
								disabled={submitted}
								rows={1}
								placeholder="输入消息，/ 命令，@ 引用文件"
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
								className="relative w-full resize-none bg-transparent px-4 pt-3 pb-1.5 font-sans text-[var(--chat-font-size,14px)] leading-[1.35] text-[var(--text)] outline-none placeholder:text-[var(--text-30,var(--text-dim))] disabled:opacity-60"
							/>
							<div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-[12px]">
								<div className="flex items-center gap-0.5">
									<span className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-30,var(--text-dim))]">
										<Plus size={15} />
									</span>
									<span className="flex h-7 items-center gap-1.5 px-2 text-[var(--text-40,var(--text-dim))]">
										<Loader2 size={12} className="animate-spin" />
										{submitted ? "启动后自动发送" : "正在启动会话"}
									</span>
								</div>
								<button
									type="button"
									aria-label="发送消息"
									title="会话启动后发送"
									disabled={!canSend}
									onClick={submit}
									className={
										canSend
											? "flex h-7 w-7 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] transition-all duration-150 hover:opacity-85 active:scale-95"
											: "flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-full bg-[var(--bg-active-fill)] text-[var(--text-30,var(--text-dim))] transition-all duration-150"
									}
								>
									<ArrowUp size={14} />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
