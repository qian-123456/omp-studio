/**
 * [A] Resume-location dialog. Always mounted; opened by lib/ensureLive via
 * `ui.openModal("resume-missing-cwd", {sessionId, cwd, repoRoot, worktreeName?})`
 * when the session's worktree directory was deleted. Resolves the pending
 * ensureLive promise via `resolveResume` / `rejectResume`.
 */

import clsx from "clsx";
import { FolderGit2, GitBranch, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { NativeSelect } from "../../components/NativeSelect";
import { errMsg } from "../../lib/dialogs";
import { rejectResume, resolveResume } from "../../lib/ensureLive";
import { isComposing } from "../../lib/hooks";
import {
	gitCreateWorktree,
	gitListBranches,
	rpcEnsureLive,
} from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";

const NEW_BRANCH = "__new";

export function ResumeMissingCwdDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "resume-missing-cwd") return null;
	const sessionId =
		typeof modal.props.sessionId === "string" ? modal.props.sessionId : "";
	return <ResumeMissingCwdForm key={sessionId} props={modal.props} />;
}

function ResumeMissingCwdForm({ props }: { props: Record<string, unknown> }) {
	const { t } = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const confirmBtnRef = useRef<HTMLButtonElement>(null);
	const closeModal = useUi((s) => s.closeModal);

	const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
	const cwd = typeof props.cwd === "string" ? props.cwd : "";
	const repoRoot = typeof props.repoRoot === "string" ? props.repoRoot : null;
	const worktreeName =
		typeof props.worktreeName === "string" && props.worktreeName
			? props.worktreeName
			: null;

	const [choice, setChoice] = useState<"main" | "worktree">(
		repoRoot ? "main" : "worktree",
	);
	const [branches, setBranches] = useState<string[] | null>(null);
	const [branchSel, setBranchSel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const cancel = () => {
		rejectResume(sessionId);
		closeModal();
	};


	// An unmount for any reason (superseded modal, app teardown) rejects the
	// pending ensureLive promise.
	useEffect(() => () => rejectResume(sessionId), [sessionId]);

	useEffect(() => {
		if (confirmBtnRef.current && !confirmBtnRef.current.disabled) {
			confirmBtnRef.current.focus();
		} else {
			const selectedRadio = dialogRef.current?.querySelector<HTMLElement>(
				'input[type="radio"]:checked',
			);
			if (selectedRadio) {
				selectedRadio.focus();
			} else {
				dialogRef.current
					?.querySelector<HTMLElement>("button:not([disabled])")
					?.focus();
			}
		}
	}, []);

	// Load the repo's branches for the recreate option. The default pick is an
	// existing branch named `<name>` or `*/<name>` (the worktree's old branch);
	// falling back to a new `omp/<name>` split off the current branch.
	useEffect(() => {
		if (!worktreeName || !repoRoot) return;
		let cancelled = false;
		gitListBranches(repoRoot)
			.then((list) => {
				if (cancelled) return;
				setBranches(list);
				const existing = list.find(
					(b) => b === worktreeName || b.endsWith(`/${worktreeName}`),
				);
				setBranchSel(existing ?? NEW_BRANCH);
			})
			.catch(() => {
				if (!cancelled) setBranches([]);
			});
		return () => {
			cancelled = true;
		};
	}, [repoRoot, worktreeName]);

	const submitMain = async () => {
		if (!repoRoot) return;
		setBusy(true);
		setError(null);
		try {
			const info = await rpcEnsureLive(sessionId, repoRoot);
			resolveResume(sessionId, info);
		} catch (err) {
			setError(errMsg(err));
			setBusy(false);
		}
	};

	const submitWorktree = async () => {
		if (!repoRoot || !worktreeName || branches === null) return;
		setBusy(true);
		setError(null);
		try {
			const opts =
				branchSel === NEW_BRANCH
					? // New branch `omp/<name>` from the repo's current branch
						// (gitListBranches returns the current branch first).
						{ branch: `omp/${worktreeName}`, base: branches[0] }
					: { branch: branchSel };
			const wt = await gitCreateWorktree(repoRoot, worktreeName, opts);
			if (wt.path !== cwd.replace(/\/+$/, "")) {
				throw new Error(t("sessions.worktreePathMismatch", { path: wt.path }));
			}
			const info = await rpcEnsureLive(sessionId);
			resolveResume(sessionId, info);
		} catch (err) {
			setError(errMsg(err));
			setBusy(false);
		}
	};

	const canConfirm =
		!busy &&
		(choice === "main" ? repoRoot !== null : worktreeName !== null && repoRoot !== null && branches !== null);

	const confirm = () => {
		if (!canConfirm) return;
		if (choice === "main") void submitMain();
		else void submitWorktree();
	};

	return (
		<Modal
			onClose={cancel}
			ariaLabel={t("sessions.resumeSession")}
			size="none"
			className="w-[500px] max-w-[calc(100vw-2rem)]"
			closeOnBackdrop={!busy}
			closeOnEscape={!busy}
		>
			<div
				ref={dialogRef}
				className="flex min-h-0 flex-1 flex-col p-5 text-neutral-300"
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
					if (isComposing(e)) return;
					if (e.key === "Enter") {
						const target = e.target as HTMLElement | null;
						if (
							target &&
							target.tagName === "BUTTON" &&
							target !== confirmBtnRef.current
						) {
							// Focused on Cancel, close X, etc. — let the button activate normally
							return;
						}
						if (target && target.tagName === "SELECT") {
							return;
						}
						e.preventDefault();
						confirm();
						return;
					}
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>(
								'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
							),
						).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
						if (controls.length === 0) return;
						const first = controls[0];
						const last = controls[controls.length - 1];
						if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="mb-3 flex items-center shrink-0">
					<span
						id="resume-missing-cwd-title"
						className="flex-1 text-[15px] font-semibold tracking-tight text-[var(--text)]"
					>
						{t("sessions.resumeSession")}
					</span>
					<button
						type="button"
						title={t("sessions.closeEsc")}
						aria-label={t("sessions.closeDialogAria")}
						disabled={busy}
						onClick={cancel}
						className="press-scale rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors disabled:opacity-40"
					>
						<X size={15} />
					</button>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto pr-1">
				<p className="mb-1 text-[12px] text-neutral-300">
					{t("sessions.sessionCwdDeletedNotice")}
				</p>
				<p className="mb-3 break-all rounded-lg hairline bg-[var(--bg)]/60 px-2.5 py-1.5 font-mono text-[11px] text-neutral-400">
					{cwd}
				</p>

				<div className="mb-3 space-y-2">
					<label
						className={clsx(
							"flex cursor-pointer items-start gap-2.5 rounded-xl hairline p-3 transition-colors",
							choice === "main"
								? "bg-[var(--bg-active-fill)]"
								: "hover:bg-[var(--bg-hover)]",
							repoRoot === null && "cursor-not-allowed opacity-50",
						)}
					>
						<input
							type="radio"
							name="resume-target"
							className="mt-0.5"
							checked={choice === "main"}
							disabled={busy || repoRoot === null}
							onChange={() => setChoice("main")}
						/>
						<span className="min-w-0">
							<span className="flex items-center gap-1.5 text-[12px] text-neutral-200">
								<FolderGit2 size={13} className="shrink-0" />
								{t("sessions.continueInMainDir")}
							</span>
							{repoRoot ? (
								<>
									<span className="mt-0.5 block break-all font-mono text-[11px] text-[#70b1ff]">
										{repoRoot}
									</span>
									<span className="mt-0.5 block text-[11px] text-neutral-500">
										{t("sessions.sessionWillMoveToMainDir")}
									</span>
								</>
							) : (
								<span className="mt-0.5 block text-[11px] text-neutral-500">
									{t("sessions.cannotDetermineRepoRoot")}
								</span>
							)}
						</span>
					</label>

					{worktreeName !== null && repoRoot !== null && (
						<label
							className={clsx(
								"flex cursor-pointer items-start gap-2.5 rounded-xl hairline p-3 transition-colors",
								choice === "worktree"
									? "bg-[var(--bg-active-fill)]"
									: "hover:bg-[var(--bg-hover)]",
							)}
						>
							<input
								type="radio"
								name="resume-target"
								className="mt-0.5"
								checked={choice === "worktree"}
								disabled={busy}
								onChange={() => setChoice("worktree")}
							/>
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-1.5 text-[12px] text-neutral-200">
									<GitBranch size={13} className="shrink-0" />
									{t("sessions.recreateWorktreeAndContinue")}
								</span>
								<span className="mt-0.5 block text-[11px] text-neutral-500">
									{t("sessions.recreateWorktreeAtPath")}
									<span className="font-mono">{cwd}</span>
								</span>
								{choice === "worktree" && (
									<span className="mt-2 block">
										<span className="mb-1 block text-[10px] text-neutral-400">
											{t("sessions.checkoutBranch")}
										</span>
										{branches === null ? (
											<span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
												<Loader2 size={12} className="animate-spin" />
												{t("sessions.loadingBranches")}
											</span>
										) : (
											<NativeSelect
												value={branchSel}
												disabled={busy}
												onChange={(e) => setBranchSel(e.target.value)}
											>
												{branches.map((b) => (
													<option key={b} value={b}>
														{b}
													</option>
												))}
												<option value={NEW_BRANCH}>
													{t("sessions.newBranchName", { name: worktreeName })}
													{branches[0] ? t("sessions.newBranchBase", { base: branches[0] }) : ""}
												</option>
											</NativeSelect>
										)}
									</span>
								)}
							</span>
						</label>
					)}
				</div>

				{error && <div className="mb-2 text-xs text-rose-400">{error}</div>}

				</div>

				<div className="flex items-center justify-end gap-2 shrink-0 pt-3 border-t border-[var(--border-divider)] mt-2">
					<button
						type="button"
						disabled={busy}
						onClick={cancel}
						className="press-scale rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors disabled:opacity-40"
					>
						{t("common.cancel")}
					</button>
					<button
						ref={confirmBtnRef}
						type="button"
						disabled={!canConfirm}
						onClick={confirm}
						className="press-scale flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 disabled:opacity-40 transition-colors"
					>
						{busy && <Loader2 size={12} className="animate-spin" />}
						{busy ? t("sessions.resuming") : t("sessions.continueAction")}
					</button>
				</div>
			</div>
		</Modal>
	);
}
