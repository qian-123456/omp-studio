import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, ChevronDown, FolderPlus, Loader2, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { StartGlow, StartHero } from "../../components/StartHero";
import { errMsg } from "../../lib/dialogs";
import { addWorkspace } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useSidebarStore } from "../sessions/sidebarStore";
import { startNewSession, startSessionInDir } from "../sessions/newSession";

/**
 * Launcher shown while no session is selected. Tasks are started in the real
 * Composer of an empty draft session, so this view only opens one — or, when
 * there is no workspace at all, asks for a project directory first.
 */
export function StartPage() {
	const activeMode = useSidebarStore((s) => s.activeMode);
	// 通用对话 always has its global workspace; project modes need a project of
	// their own (workspaces of other modes never count).
	const ready = useSessions((s) => s.workspaces.some((w) => w.mode === activeMode));
	const launchedMode = useRef<string | null>(null);

	useEffect(() => {
		if (!ready || launchedMode.current === activeMode) return;
		launchedMode.current = activeMode;
		void startNewSession();
	}, [ready, activeMode]);

	const pickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: "选择项目目录",
			});
			const path = typeof selected === "string" ? selected : selected?.[0];
			if (!path) return;
			// New directories land in the CURRENT space, never in another mode.
			const ws = await addWorkspace(path, activeMode);
			await useSessions.getState().refreshWorkspaces();
			await startSessionInDir(ws, false);
		} catch (e) {
			toast.error(`添加工作区失败: ${errMsg(e)}`);
		}
	};

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-6 pb-[6vh] select-none">
			<StartGlow />
			<div className="relative flex w-full max-w-[880px] flex-col items-center">
				<StartHero />
				{ready ? (
					<Loader2 size={16} className="animate-spin text-[var(--text-dim)]" />
				) : (
					<button
						type="button"
						onClick={() => void pickDirectory()}
						className="start-rise w-full rounded-[22px] border border-[var(--line,var(--border))] bg-[var(--bg-panel)] text-left transition-colors hover:border-[var(--text-30,var(--border))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
						aria-label="选择项目目录开始"
					>
						<div className="flex items-center gap-1.5 border-b border-[var(--line,var(--border-divider))] px-3.5 py-2 text-[var(--text-60,var(--text-muted))]">
							<FolderPlus size={14} className="shrink-0" />
							<span className="text-[13px]">选择项目目录</span>
							<ChevronDown size={11} className="shrink-0 text-[var(--text-40,var(--text-dim))]" />
						</div>
						<div className="px-4 pb-3 pt-3.5 text-[14px] text-[var(--text-40,var(--text-dim))]">
							先选择一个项目目录，再开始输入…
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
