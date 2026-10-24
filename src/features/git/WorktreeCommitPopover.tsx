import clsx from "clsx";
import { Loader2, PenLine, Save, Sparkles } from "lucide-react";
import { useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { gitCommit, gitCommitSuggest } from "../../lib/ipc";
import { isInside } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { useSessions } from "../../stores/sessions";

/**
 * Commit-everything popover anchored on a worktree row's 提交 button. Mirrors the
 * ChangesSection composer: AI-written message by default, optional hand-written one.
 */
export function WorktreeCommitPopover({
	cwd,
	branch,
	fileCount,
	anchor,
	onDismiss,
	onCommitted,
}: {
	cwd: string;
	branch: string;
	fileCount: number;
	anchor: HTMLElement;
	onDismiss: () => void;
	onCommitted: () => void;
}) {
	const { t } = useT();
	const [message, setMessage] = useState("");
	const [custom, setCustom] = useState(false);
	const [phase, setPhase] = useState<"idle" | "naming" | "saving">("idle");
	const busy = phase !== "idle";
	// An agent still editing this worktree would get committed mid-change.
	const working = useSessions((s) =>
		Object.values(s.sessions).some(
			(m) => m.status === "working" && !!m.cwd && isInside(m.cwd, cwd),
		),
	);

	const suggest = async () => {
		setPhase("naming");
		try {
			setMessage((await gitCommitSuggest(cwd)).trim());
			setCustom(true);
		} catch (e) {
			toast.error(t("worktree.commit.suggestFailed", { error: errMsg(e) }));
		} finally {
			setPhase("idle");
		}
	};

	const save = async () => {
		let msg = custom ? message.trim() : "";
		try {
			if (!msg) {
				setPhase("naming");
				msg = (await gitCommitSuggest(cwd)).trim();
				if (!msg) throw new Error(t("worktree.commit.aiNoDescription"));
			}
			setPhase("saving");
			await gitCommit(cwd, msg);
			toast.success(t("worktree.commit.committedToast", { branch, summary: msg.split("\n")[0] }));
			onCommitted();
			onDismiss();
		} catch (e) {
			toast.error(t("worktree.commit.commitFailed", { error: errMsg(e) }));
			if (!msg) setCustom(true);
		} finally {
			setPhase("idle");
		}
	};

	return (
		<FloatingLayer
			anchor={anchor}
			placement="bottom-end"
			layer="menu"
			onDismiss={() => {
				if (!busy) onDismiss();
			}}
			className="w-72 space-y-1.5 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl"
		>
			<div className="truncate text-[11px] font-medium text-neutral-300">
				{t("worktree.commit.commitAllChanges", { branch, count: fileCount })}
			</div>
			{working && (
				<div className="rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
					{t("worktree.commit.workingWarning")}
				</div>
			)}
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || (custom && !message.trim())}
					className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
				>
					{busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
					<span className="truncate">
						{phase === "naming"
							? t("git.changes.generatingDesc")
							: phase === "saving"
								? t("worktree.commit.committing")
								: custom
									? t("worktree.commit.submitCustom")
									: t("worktree.commit.aiSubmit")}
					</span>
				</button>
				<button
					type="button"
					onClick={() => setCustom((v) => !v)}
					aria-pressed={custom}
					aria-label={t("git.changes.customDescAria")}
					title={t("git.changes.customDescTitle")}
					className={clsx(
						"shrink-0 rounded-md border p-1.5 transition-colors",
						custom
							? "border-neutral-500 bg-neutral-800 text-neutral-100"
							: "border-neutral-700/80 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300",
					)}
				>
					<PenLine size={12} />
				</button>
			</div>
			{custom && (
				<div className="space-y-1">
					<textarea
						autoFocus
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								if (!busy && message.trim()) void save();
							}
						}}
						disabled={busy}
						rows={3}
						placeholder={t("worktree.commit.customPlaceholder")}
						className="w-full resize-y rounded-md border border-neutral-700/80 bg-neutral-950/80 p-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={() => void suggest()}
						disabled={busy}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
					>
						<Sparkles size={11} />
						{t("git.changes.aiSuggestFirst")}
					</button>
				</div>
			)}
		</FloatingLayer>
	);
}
