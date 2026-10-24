/**
 * Session overflow actions menu (Task C fold + Task D resilience commands).
 * Folds low-frequency header actions (Finder, Share/Pair) and provides
 * resilience commands:
 * - /fresh equivalent: 重置流连接（保留历史） via rpcRestart
 * - /clear equivalent: 清空上下文（保留会话） honest backend limitation notice
 */
import {
	Copy,
	Eraser,
	FileDown,
	FolderOpen,
	MoreHorizontal,
	QrCode,
	RefreshCw,
	Terminal,
} from "lucide-react";
import { useRef, useState } from "react";
import clsx from "clsx";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { copyText } from "../lib/dialogs";
import { rpcRestart, sessionExportHtml, sessionResumeCommand } from "../lib/ipc";
import { toast } from "../lib/toast";
import { useT } from "../stores/language";
import { FloatingLayer } from "./FloatingLayer";
export interface SessionOverflowMenuProps {
	sessionId: string;
	cwd?: string | null;
	onOpenInFinder?: () => void;
	onCopyMarkdown?: () => void;
	onMobilePair?: () => void;

	className?: string;
}

export function SessionOverflowMenu({
	sessionId,
	cwd,
	onOpenInFinder,
	onCopyMarkdown,
	onMobilePair,

	className,
}: SessionOverflowMenuProps) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);


	const handleFreshRestart = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await rpcRestart(sessionId);
			toast.info(t("shell.streamResetSuccess"));
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(t("shell.streamResetFailed", { error: msg }));
		} finally {
			setBusy(false);
		}
	};

	const handleClearContextNotice = () => {
		toast.info(
			t("shell.clearContextNotSupportedMsg"),
			5000,
		);
		setOpen(false);
	};

	const handleExportHtml = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const outPath = await sessionExportHtml(sessionId);
			toast.success(t("shell.exportedHtml", { path: outPath }));
			try {
				await revealItemInDir(outPath);
			} catch (err) {
				console.warn("Failed to reveal in Finder:", err);
			}
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(t("shell.exportHtmlFailed", { error: msg }));
		} finally {
			setBusy(false);
		}
	};

	const handleCopyResumeCommand = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await copyText(await sessionResumeCommand(sessionId));
			toast.success(t("shell.copyResumeCommandSuccess"));
			setOpen(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(t("shell.copyResumeCommandFailed", { error: msg }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={clsx("relative z-20", className)}>
			<button
				ref={btnRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label={t("shell.moreSessionActions")}
				aria-haspopup="menu"
				aria-expanded={open}
				title={t("shell.moreActions")}
				className={clsx(
					"flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95",
					open
						? "bg-[var(--bg-active-fill)] text-neutral-100"
						: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
				)}
			>
				<MoreHorizontal size={14} />
			</button>

			<FloatingLayer
				anchor={open ? btnRef.current : null}
				placement="bottom-end"
				offset={4}
				layer="menu"
				ignoreRefs={[btnRef]}
				onDismiss={() => setOpen(false)}
				role="menu"
				aria-orientation="vertical"
				className="w-60 p-1 text-xs"
			>
					{/* Section 1: 会话弹性与恢复 */}
					<div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-neutral-400/80 uppercase">
						{t("shell.sectionConnection")}
					</div>

					{/* /fresh equivalent: 重置流连接（保留历史） */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleFreshRestart}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-200 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]"
						title={t("shell.resetStreamTip")}
					>
						<RefreshCw
							size={13}
							className={clsx("shrink-0 text-emerald-400", busy && "animate-spin")}
						/>
						<span className="flex-1 truncate">{t("shell.resetStreamAction")}</span>
					</button>



					{/* /clear equivalent: 清空上下文（保留会话） */}
					<button
						type="button"
						role="menuitem"
						onClick={handleClearContextNotice}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-all active:scale-[0.98]"
						title={t("shell.clearContextTip")}
					>
						<Eraser size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">{t("shell.clearContextAction")}</span>
						<span className="shrink-0 rounded-md bg-amber-500/15 border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium">
							{t("shell.unsupportedTag")}
						</span>
					</button>

					<div className="my-1 border-t border-[var(--border-divider)]" />

					{/* Section 2: 折叠的常用操作 (Task C fold) */}
					<div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-neutral-400/80 uppercase">
						{t("shell.sectionQuickActions")}
					</div>

					{/* 在访达中显示 */}
					{onOpenInFinder && (
						<button
							type="button"
							role="menuitem"
							disabled={!cwd}
							onClick={() => {
								setOpen(false);
								onOpenInFinder();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30 transition-all active:scale-[0.98]"
							title={cwd ? t("shell.revealInFinder", { path: cwd }) : t("shell.noCwd")}
						>
							<FolderOpen size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">{t("shell.revealInFinderAction")}</span>
						</button>
					)}

					{/* 复制为 Markdown */}
					{onCopyMarkdown && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onCopyMarkdown();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-all active:scale-[0.98]"
						>
							<Copy size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">{t("shell.copyAsMarkdown")}</span>
						</button>
					)}

					{/* 导出 HTML */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleExportHtml}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]"
						title={t("shell.exportHtmlTip")}
					>
						<FileDown size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">{t("shell.exportHtmlAction")}</span>
					</button>

					{/* 复制终端续接命令 */}
					<button
						type="button"
						role="menuitem"
						disabled={busy}
						onClick={handleCopyResumeCommand}
						className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]"
						title={t("shell.copyResumeCommandTip")}
					>
						<Terminal size={13} className="shrink-0 text-neutral-400" />
						<span className="flex-1 truncate">{t("shell.copyResumeCommandAction")}</span>
					</button>

					{/* 手机扫码查看 */}
					{onMobilePair && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onMobilePair();
							}}
							className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-all active:scale-[0.98]"
						>
							<QrCode size={13} className="shrink-0 text-neutral-400" />
							<span className="flex-1 truncate">{t("shell.mobileScan")}</span>
						</button>
					)}
			</FloatingLayer>
		</div>
	);
}
