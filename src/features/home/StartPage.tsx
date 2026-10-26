import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, ChevronDown, Folder, FolderPlus, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { StartGlow, StartHero } from "../../components/StartHero";
import { LoadFailed } from "../../components/LoadFailed";
import { errMsg } from "../../lib/dialogs";
import { deriveLoadState } from "../../lib/loadState";
import { addWorkspace } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { usePendingSession } from "../sessions/pendingSession";
import { useSidebarStore } from "../sessions/sidebarStore";
import { resolveNewSessionTargetWorkspace } from "../sessions/modes";
import { startNewSession, startSessionInDir } from "../sessions/newSession";

/** Auto-launch tries per failure streak before the launcher shows a retry button. */
const MAX_AUTO_ATTEMPTS = 2;

/**
 * Launch attempts live outside the component: a failed attempt swaps the view
 * to the pending placeholder and back, remounting StartPage, so a per-mount
 * ref could neither cap the retries nor remember the failure.
 */
const useLauncher = create<{ attempts: number }>(() => ({ attempts: 0 }));

/** Open a session in the launcher's workspace; a launch that ends with nothing selected counts as failed. */
async function launch(manual: boolean): Promise<void> {
	useLauncher.setState((s) => ({ attempts: manual ? 1 : s.attempts + 1 }));
	await startNewSession();
	const started =
		useUi.getState().selectedSessionId !== null ||
		usePendingSession.getState().selectedId !== null;
	if (started) useLauncher.setState({ attempts: 0 });
	else if (manual) useLauncher.setState({ attempts: MAX_AUTO_ATTEMPTS });
}

/**
 * Typeable stand-in shown while the launcher has a workspace but no session
 * view yet. The first keystroke starts the session (the optimistic placeholder
 * or an existing empty draft takes over) and carries the typed text across.
 */
function LaunchComposer({
	onLaunch,
	failed,
	onRetry,
}: {
	onLaunch: () => Promise<void>;
	failed: boolean;
	onRetry: () => void;
}) {
	const { t } = useT();
	const [text, setText] = useState("");
	const activeMode = useSidebarStore((s) => s.activeMode);
	const creating = useSidebarStore((s) => s.creatingKey !== null);
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const target = resolveNewSessionTargetWorkspace(activeMode, null, sessions, workspaces);
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		ref.current?.focus();
	}, []);

	const handleChange = (value: string) => {
		setText(value);
		if (!value) return;
		void onLaunch();
		// The local draft is selected synchronously; reusing an existing empty
		// session selects that session instead.
		const sink = useUi.getState().selectedSessionId ?? usePendingSession.getState().selectedId;
		if (sink) useComposer.getState().setDraft(sink, value);
	};

	return (
		<div className="start-rise w-full rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] select-text">
			<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-3.5 py-2 text-[13px] text-[var(--text-60,var(--text-muted))]">
				<Folder size={14} className="shrink-0 text-neutral-400" />
				<span title={target?.path} className="font-medium">
					{target ? target.name : t("home.noProjectSelected")}
				</span>
				{failed ? (
					<button
						type="button"
						onClick={onRetry}
						className="ml-2 rounded-full border border-red-400/50 bg-red-500/10 px-2.5 py-0.5 text-[12px] text-red-600 transition-colors hover:bg-red-500/20"
					>
						{t("home.sessionStartFailedRetry")}
					</button>
				) : (
					<span className="ml-2 flex items-center gap-1.5 text-[var(--text-40,var(--text-dim))]">
						<Loader2 size={12} className="animate-spin" />
						{creating ? t("home.creatingSession") : t("home.preparingSession")}
					</span>
				)}
			</div>
			<textarea
				ref={ref}
				value={text}
				rows={1}
				onChange={(e) => handleChange(e.target.value)}
				placeholder={t("home.inputPlaceholder")}
				aria-label={t("home.inputAriaLabel")}
				className="field-sizing-content min-h-[1.35em] w-full resize-none bg-transparent px-4 pb-1.5 pt-3 text-[14px] leading-[1.35] text-[var(--text)] outline-none placeholder:text-[var(--text-40,var(--text-dim))]"
			/>
			<div className="flex items-center justify-between px-2.5 pb-2 text-[12px] text-[var(--text-40,var(--text-dim))]">
				<div className="flex items-center gap-0.5">
					<span className="flex h-7 w-7 items-center justify-center">
						<Plus size={15} />
					</span>
					<span className="flex items-center gap-1.5 px-2 py-1">
						<Loader2 size={12} className="animate-spin" />
						{t("home.loadingModel")}
					</span>
				</div>
				<span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-active-fill)] text-[var(--text-30,var(--text-dim))]">
					<ArrowUp size={14} />
				</span>
			</div>
		</div>
	);
}

/**
 * Launcher shown while no session is selected. Tasks are started in the real
 * Composer of an empty draft session, so this view only opens one — or, when
 * there is no workspace at all, asks for a project directory first.
 */
export function StartPage() {
	const { t } = useT();
	const activeMode = useSidebarStore((s) => s.activeMode);
	// 通用对话 always has its global workspace; project modes need a project of
	// their own (workspaces of other modes never count).
	const ready = useSessions((s) => s.workspaces.some((w) => w.mode === activeMode));
	// Until the workspace list arrives, "no project" is unknown, not true.
	const loadState = deriveLoadState(
		useSessions((s) => s.hasLoaded),
		useSessions((s) => s.loadError),
	);
	const loadError = useSessions((s) => s.loadError);
	// A creation already in flight makes `startNewSession` a silent no-op, so
	// wait for it to finish instead of burning a launch attempt.
	const creating = useSidebarStore((s) => s.creatingKey !== null);
	const attempts = useLauncher((s) => s.attempts);
	const failed = ready && !creating && attempts >= MAX_AUTO_ATTEMPTS;

	useEffect(() => {
		if (!ready || loadState !== "ready" || creating || attempts >= MAX_AUTO_ATTEMPTS) return;
		void launch(false);
	}, [ready, loadState, creating, activeMode, attempts]);

	const pickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: t("home.selectProjectDir"),
			});
			const path = typeof selected === "string" ? selected : selected?.[0];
			if (!path) return;
			// New directories land in the CURRENT space, never in another mode.
			const ws = await addWorkspace(path, activeMode);
			await useSessions.getState().refreshWorkspaces();
			await startSessionInDir(ws, false);
		} catch (e) {
			toast.error(t("home.addWorkspaceFailed", { error: errMsg(e) }));
		}
	};

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-6 pb-[6vh] select-none">
			<StartGlow />
			<div className="relative flex w-full max-w-[880px] flex-col items-center">
				<StartHero />
				{loadState === "loading" ? (
					<div
						role="status"
						className="start-rise flex w-full animate-pulse items-center gap-2 rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] px-4 py-6 text-[14px] text-[var(--text-40,var(--text-dim))]"
					>
						<Loader2 size={14} className="animate-spin" />
						{t("home.loading")}
					</div>
				) : loadState === "error" ? (
					<div className="start-rise w-full rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)]">
						<LoadFailed
							what={t("home.projectList")}
							error={loadError}
							onRetry={() => void useSessions.getState().load().catch(() => {})}
						/>
					</div>
				) : ready ? (
					<LaunchComposer
						onLaunch={() => startNewSession()}
						failed={failed}
						onRetry={() => void launch(true)}
					/>
				) : (
					<button
						type="button"
						onClick={() => void pickDirectory()}
						className="start-rise w-full rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] text-left transition-colors hover:border-[var(--text-30,var(--border))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
						aria-label={t("home.selectProjectDirToStart")}
					>
						<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-3.5 py-2 text-[var(--text-60,var(--text-muted))]">
							<FolderPlus size={14} className="shrink-0" />
							<span className="text-[13px]">{t("home.selectProjectDir")}</span>
							<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
						</div>
						<div className="px-4 pb-3 pt-3.5 text-[14px] text-[var(--text-40,var(--text-dim))]">
							{t("home.selectProjectDirFirst")}
						</div>
						<div className="flex items-center justify-between px-3.5 pb-3">
							<Plus size={16} className="text-[var(--text-40,var(--text-dim))]" />
							<span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-active-fill)] text-[var(--text-40,var(--text-dim))]">
								<ArrowUp size={15} />
							</span>
						</div>
					</button>
				)}
			</div>
		</div>
	);
}
