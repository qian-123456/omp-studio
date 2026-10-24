/** Global dialog that installs the omp 内核 (official installer) and reports progress. */
import { CheckCircle2, ChevronDown, ChevronRight, Download, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import { formatBytes } from "../../lib/format";
import { ompVersionLabel, useOmpUpdate } from "../../stores/ompUpdate";
import { useOmpInstall } from "../../stores/ompInstall";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { Button } from "../settings/ui";
import { openSettingsTarget } from "../settings/settingsTargets";

const UNIX_COMMAND = "curl -fsSL https://omp.sh/install | sh";
const WINDOWS_COMMAND = "irm https://omp.sh/install.ps1 | iex";
const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

function formatElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function LogBox({ text, autoScroll }: { text: string; autoScroll?: boolean }) {
	const { t } = useT();
	const ref = useRef<HTMLPreElement>(null);
	useEffect(() => {
		if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
	}, [text, autoScroll]);
	return (
		<pre
			ref={ref}
			className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-all rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-2 font-mono text-[11px] leading-4 text-[var(--text-muted)]"
		>
			{text || t("ompInstall.noOutput")}
		</pre>
	);
}

function ManualCommand() {
	const { t } = useT();
	const command = IS_WINDOWS ? WINDOWS_COMMAND : UNIX_COMMAND;
	return (
		<div className="space-y-1">
			<div className="text-xs text-[var(--text-muted)]">
				{t("ompInstall.manualCommandHint", { target: IS_WINDOWS ? t("ompInstall.targetPowershell") : t("ompInstall.targetTerminal") })}
			</div>
			<div className="flex items-center gap-2 rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5">
				<code className="min-w-0 flex-1 select-text break-all font-mono text-[11px] text-[var(--text)]">{command}</code>
				<CopyButton text={command} />
			</div>
		</div>
	);
}

function Running() {
	const { t } = useT();
	const lines = useOmpInstall((s) => s.lines);
	const downloaded = useOmpInstall((s) => s.downloadedBytes);
	const startedAt = useOmpInstall((s) => s.startedAt);
	const cancel = useOmpInstall((s) => s.cancel);
	const [now, setNow] = useState(() => Date.now());
	const [logOpen, setLogOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	const stage = [...lines].reverse().find((l) => l.trim()) ?? t("ompInstall.stagePreparing");
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-[var(--text-muted)]">
				{t("ompInstall.installIntro")}
			</p>
			<div className="rounded-lg hairline bg-[var(--well-bg)] px-3 py-2.5">
				<div className="select-text break-all text-[13px] text-[var(--text)]">{stage}</div>
				<div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-muted)]">
					{downloaded != null && <span>{t("ompInstall.downloadedBytes", { bytes: formatBytes(downloaded) })}</span>}
					<span>{t("ompInstall.elapsedTime", { time: startedAt ? formatElapsed(now - startedAt) : "0:00" })}</span>
				</div>
			</div>
			<button
				type="button"
				onClick={() => setLogOpen((v) => !v)}
				className="flex items-center gap-1 whitespace-nowrap text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
			>
				{logOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				{t("ompInstall.fullLog")}
			</button>
			{logOpen && <LogBox text={lines.join("\n")} autoScroll />}
			<div className="flex justify-end">
				<Button
					loading={cancelling}
					onClick={() => {
						setCancelling(true);
						void cancel().finally(() => setCancelling(false));
					}}
				>
					{t("common.cancel")}
				</Button>
			</div>
		</div>
	);
}

function Success() {
	const { t } = useT();
	const info = useOmpUpdate((s) => s.info);
	const status = useOmpUpdate((s) => s.status);
	const result = useOmpInstall((s) => s.result);
	const close = useOmpInstall((s) => s.close);
	const version = ompVersionLabel(info, status) ?? ompVersionLabel(result?.info ?? null, null);
	return (
		<div className="space-y-3">
			<Notice tone="success" title={version ? t("ompInstall.installedTitleVersion", { version }) : t("ompInstall.installedTitleNoVersion")}>
				<span className="select-text break-all">{result?.info.resolvedPath}</span>
			</Notice>
			<p className="text-xs leading-5 text-[var(--text-muted)]">{t("ompInstall.installedDesc")}</p>
			<div className="flex justify-end gap-2">
				<Button
					onClick={() => {
						close();
						openSettingsTarget("providers");
					}}
				>
					{t("ompInstall.btnConfigModels")}
				</Button>
				<Button variant="primary" icon={CheckCircle2} onClick={close}>
					{t("ompInstall.btnStartUsing")}
				</Button>
			</div>
		</div>
	);
}

function Failed() {
	const { t } = useT();
	const result = useOmpInstall((s) => s.result);
	const error = useOmpInstall((s) => s.error);
	const cancelled = useOmpInstall((s) => s.cancelled);
	const start = useOmpInstall((s) => s.start);
	const recheck = useOmpInstall((s) => s.recheck);
	const close = useOmpInstall((s) => s.close);
	const [checking, setChecking] = useState(false);
	const [notFound, setNotFound] = useState(false);
	const text = result?.output ?? error ?? "";
	return (
		<div className="space-y-3">
			<Notice tone={cancelled ? "warning" : "danger"} title={cancelled ? t("ompInstall.cancelledTitle") : t("ompInstall.failedTitle")} />
			<LogBox text={text} />
			<ManualCommand />
			{notFound && <div className="text-xs text-[var(--status-error)]">{t("ompInstall.notFoundWarning")}</div>}
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					loading={checking}
					onClick={() => {
						setChecking(true);
						void recheck()
							.then((found) => setNotFound(!found))
							.finally(() => setChecking(false));
					}}
				>
					{t("ompInstall.btnRecheckManual")}
				</Button>
				<Button
					onClick={() => {
						close();
						useUi.getState().openSettings("advanced", { focusKey: "ompBinary" });
					}}
				>
					{t("ompInstall.btnSpecifyPath")}
				</Button>
				{!IS_WINDOWS && (
					<Button variant="primary" icon={RefreshCw} onClick={() => void start()}>
						{t("common.retry")}
					</Button>
				)}
			</div>
		</div>
	);
}

function CustomPathMissing() {
	const { t } = useT();
	const ompBinary = useOmpUpdate((s) => s.info?.resolvedPath);
	const switchToAutoInstall = useOmpInstall((s) => s.switchToAutoInstall);
	const close = useOmpInstall((s) => s.close);
	return (
		<div className="space-y-3">
			<Notice tone="warning" title={t("ompInstall.titleBinaryNotFound")}>
				<span className="select-text break-all">{ompBinary || t("ompInstall.invalidPathFallback")}</span>
			</Notice>
			<p className="text-xs leading-5 text-[var(--text-muted)]">
				{t("ompInstall.binaryNotFoundDesc")}
			</p>
			<div className="flex justify-end gap-2">
				<Button
					onClick={() => {
						close();
						useUi.getState().openSettings("advanced", { focusKey: "ompBinary" });
					}}
				>
					{t("ompInstall.btnGoSettings")}
				</Button>
				{!IS_WINDOWS && (
					<Button variant="primary" icon={Download} onClick={() => void switchToAutoInstall()}>
						{t("ompInstall.btnSwitchAutoInstall")}
					</Button>
				)}
			</div>
		</div>
	);
}

export function OmpInstallDialog() {
	const { t } = useT();
	const open = useOmpInstall((s) => s.open);
	const phase = useOmpInstall((s) => s.phase);
	const customPathMissing = useOmpInstall((s) => s.customPathMissing);
	const close = useOmpInstall((s) => s.close);
	if (!open) return null;
	return (
		<Modal
			onClose={close}
			title={t("ompInstall.dialogTitle")}
			icon={<Download className="h-4 w-4" />}
			size="lg"
			closeOnBackdrop={false}
			closeOnEscape={phase !== "running"}
		>
			<div className="min-h-0 overflow-y-auto p-4">
				{phase === "running" ? (
					<Running />
				) : phase === "success" ? (
					<Success />
				) : phase === "failed" ? (
					<Failed />
				) : customPathMissing ? (
					<CustomPathMissing />
				) : (
					<Notice tone="info" title={t("ompInstall.noticeNotInstalledTitle")}>
						<Button variant="primary" icon={Download} onClick={() => void useOmpInstall.getState().start()}>
							{t("ompInstall.btnStartInstall")}
						</Button>
					</Notice>
				)}
			</div>
		</Modal>
	);
}
