import clsx from "clsx";
import { AlertTriangle, Camera, Check, Clock, Copy, EyeOff, ImagePlus, Loader2, QrCode, Wifi, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mobileCameraAck, mobileCameraPoll, mobileCameraStart, mobileCameraStop } from "../lib/ipc";
import type { CameraLink, CameraPhoto, CameraSnapshot } from "../lib/mobileCameraTypes";
import { useT } from "../stores/language";
import { Modal } from "./Modal";
type Issue = { kind: "start" | "poll" | "photo" | "ack" | "copy"; error: string; photo?: CameraPhoto };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

// A dismissed dialog must finish releasing its connection before another starts.
let lifecycle: Promise<void> = Promise.resolve();
function serializeLifecycle(operation: () => Promise<void>): void {
	lifecycle = lifecycle.then(operation, operation).catch(() => {});
}

export function PhoneCameraDialog({ onPhoto, onClose }: {
	onPhoto: (photo: CameraPhoto, isCurrent: () => boolean) => Promise<boolean>;
	onClose: () => void;
}) {
	const { t, locale } = useT();
	const [link, setLink] = useState<CameraLink | null>(null);
	const [snapshot, setSnapshot] = useState<CameraSnapshot | null>(null);
	const [issue, setIssue] = useState<Issue | null>(null);
	const [photoIssues, setPhotoIssues] = useState<Record<string, Issue>>({});
	const [busy, setBusy] = useState(false);
	const [count, setCount] = useState(0);
	const [now, setNow] = useState(Date.now());
	const [attempt, setAttempt] = useState(0);
	const [copied, setCopied] = useState(false);
	const [showQr, setShowQr] = useState(true);
	const collapsedOnce = useRef(false);
	const onPhotoRef = useRef(onPhoto);
	onPhotoRef.current = onPhoto;
	const retryRef = useRef<((photoId?: string) => void) | null>(null);
	const activeRef = useRef(false);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let active = true;
		let captureId: string | undefined;
		activeRef.current = true;
		let timer: number | undefined;
		const attached = new Set<string>();
		const confirmed = new Set<string>();
		const failed = new Set<string>();
		let locked = false;
		const current = () => active && activeRef.current;
		const processPhoto = async (photo: CameraPhoto) => {
			if (!captureId || !current()) return;
			setBusy(true);
			try {
				if (!attached.has(photo.id)) {
					let ok: boolean;
					try {
						ok = await onPhotoRef.current(photo, current);
					} catch (error) {
						if (!current()) return;
						const detail = message(error);
						failed.add(photo.id);
						setPhotoIssues((issues) => ({ ...issues, [photo.id]: { kind: "photo", error: detail, photo } }));
						try { await mobileCameraAck(captureId, photo.id, detail); } catch { /* retrying the attachment sends a new acknowledgement */ }
						return;
					}
					if (!current()) return;
					if (!ok) {
						const detail = t("chat.phoneCamera.unknownError");
						failed.add(photo.id);
						setPhotoIssues((issues) => ({ ...issues, [photo.id]: { kind: "photo", error: detail, photo } }));
						try { await mobileCameraAck(captureId, photo.id, detail); } catch { /* retry remains available */ }
						return;
					}
					attached.add(photo.id);
				}
				try {
					await mobileCameraAck(captureId, photo.id);
					if (!current()) return;
					if (!confirmed.has(photo.id)) {
						confirmed.add(photo.id);
						setCount(confirmed.size);
					}
					setPhotoIssues((issues) => {
						const next = { ...issues };
						delete next[photo.id];
						return next;
					});
				} catch (error) {
					if (current()) setPhotoIssues((issues) => ({ ...issues, [photo.id]: { kind: "ack", error: message(error), photo } }));
				}
			} finally {
				if (current()) setBusy(false);
			}
		};
		const poll = async () => {
			if (!current() || !captureId || locked) return;
			locked = true;
			try {
				const next = await mobileCameraPoll(captureId);
				if (!current() || next.captureId !== captureId) return;
				setSnapshot(next);
				if (next.state === "connected" && !collapsedOnce.current) {
					collapsedOnce.current = true;
					setShowQr(false);
				}
				setIssue((previous) => previous?.kind === "poll" ? null : previous);
				if (next.state === "expired" || next.state === "stopped") { activeRef.current = false; return; }
				for (const photo of next.photos) {
					if (!current()) return;
					if (photo.state === "attached") {
						failed.delete(photo.id);
						setPhotoIssues((issues) => {
							if (!issues[photo.id]) return issues;
							const next = { ...issues };
							delete next[photo.id];
							return next;
						});
						attached.add(photo.id);
						if (!confirmed.has(photo.id)) { confirmed.add(photo.id); setCount(confirmed.size); }
					} else if (!confirmed.has(photo.id) && !failed.has(photo.id)) {
						await processPhoto(photo);
						if (!confirmed.has(photo.id)) break;
					}
				}
			} catch (error) {
				if (current()) setIssue({ kind: "poll", error: message(error) });
			} finally {
				locked = false;
				if (current()) timer = window.setTimeout(poll, 500);
			}
		};
		retryRef.current = (photoId) => {
			if (photoId) {
				failed.delete(photoId);
				setPhotoIssues((issues) => {
					const next = { ...issues };
					delete next[photoId];
					return next;
				});
			} else {
				setIssue(null);
			}
			clearTimeout(timer);
			void poll();
		};
		collapsedOnce.current = false;
		setShowQr(true);
		setLink(null); setSnapshot(null); setIssue(null); setPhotoIssues({}); setCount(0);
		serializeLifecycle(async () => {
			if (!current()) return;
			try {
				const started = await mobileCameraStart(locale);
				if (!current()) {
					await mobileCameraStop(started.captureId);
					return;
				}
				captureId = started.captureId;
				setLink(started);
				void poll();
			} catch (error) {
				if (current()) setIssue({ kind: "start", error: message(error) });
			}
		});
		return () => {
			active = false;
			activeRef.current = false;
			retryRef.current = null;
			clearTimeout(timer);
			if (captureId) {
				const id = captureId;
				serializeLifecycle(() => mobileCameraStop(id));
			}
		};
	}, [attempt]); // Language is fixed for the lifetime of each connection.

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const panel = contentRef.current?.closest('[role="dialog"]');
			if (!panel) return;
			const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
			if (!controls.length) { event.preventDefault(); return; }
			const first = controls[0];
			const last = controls[controls.length - 1];
			if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
				event.preventDefault(); last.focus();
			} else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement) || document.activeElement === panel)) {
				event.preventDefault(); first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);


	const seconds = link ? Math.max(0, Math.ceil((Date.parse(link.expiresAt) - now) / 1000)) : 0;
	const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
	const ended = snapshot?.state === "expired" || snapshot?.state === "stopped";
	const status = ended ? "ended" : busy ? "receiving" : snapshot?.state === "connected" ? "connected" : link ? "waiting" : "starting";
	const copy = async () => {
		if (!link) return;
		try { await navigator.clipboard.writeText(link.url); setCopied(true); }
		catch (error) { setIssue({ kind: "copy", error: message(error) }); }
	};
	const close = () => { activeRef.current = false; onClose(); };
	const errors = <>
		{issue && <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_9%,transparent)] p-3 text-xs text-[var(--status-error)]">
			<div className="flex min-w-0 flex-1 items-start gap-2">
				<AlertTriangle size={14} className="mt-0.5 shrink-0" />
				<p className="break-words leading-relaxed">{t(`chat.phoneCamera.${issue.kind === "start" ? "startError" : issue.kind === "poll" ? "pollError" : issue.kind === "photo" ? "photoError" : issue.kind === "ack" ? "ackError" : "copyError"}`, { error: issue.error })}</p>
			</div>
			{issue.kind !== "copy" && <button type="button" className="shrink-0 whitespace-nowrap rounded-md border border-[color-mix(in_srgb,var(--status-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--status-error)] transition-all hover:bg-[color-mix(in_srgb,var(--status-error)_20%,transparent)] active:scale-95" onClick={() => issue.kind === "start" ? setAttempt((n) => n + 1) : retryRef.current?.()}>{t(issue.kind === "photo" ? "chat.phoneCamera.retryPhoto" : "chat.phoneCamera.retry")}</button>}
		</div>}
		{Object.entries(photoIssues).map(([photoId, photoIssue]) => <div key={photoId} role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_9%,transparent)] p-3 text-xs text-[var(--status-error)]">
			<div className="flex min-w-0 flex-1 items-start gap-2">
				<AlertTriangle size={14} className="mt-0.5 shrink-0" />
				<p className="break-words leading-relaxed">{photoIssue.photo?.name}: {t(`chat.phoneCamera.${photoIssue.kind === "photo" ? "photoError" : "ackError"}`, { error: photoIssue.error })}</p>
			</div>
			<button type="button" className="shrink-0 whitespace-nowrap rounded-md border border-[color-mix(in_srgb,var(--status-error)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--status-error)] transition-all hover:bg-[color-mix(in_srgb,var(--status-error)_20%,transparent)] active:scale-95" onClick={() => retryRef.current?.(photoId)}>{t(photoIssue.kind === "photo" ? "chat.phoneCamera.retryPhoto" : "chat.phoneCamera.retry")}</button>
		</div>)}
	</>;
	if (!showQr) return <div className="mx-2 my-1 flex flex-col gap-2 rounded-xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-2.5 text-xs shadow-sm">
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div role="status" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				<span className={clsx(
					"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
					status === "connected" && "bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] text-[var(--status-success)]",
					status === "receiving" && "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]",
					status === "waiting" && "bg-[color-mix(in_srgb,var(--status-warning)_16%,transparent)] text-[var(--status-warning)]",
					(status === "ended" || status === "starting") && "bg-[var(--bg-active-fill)] text-[var(--text-muted)]",
				)}>
					<span className={clsx(
						"h-1.5 w-1.5 rounded-full",
						status === "connected" && "bg-[var(--status-success)]",
						status === "waiting" && "bg-[var(--status-warning)] animate-pulse",
						(status === "ended" || status === "starting") && "bg-[var(--text-muted)]",
					)} />
					{t(`chat.phoneCamera.${status}`)}
				</span>
				<span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--bg-active-fill)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
					<ImagePlus size={12} />
					{t("chat.phoneCamera.added", { count })}
				</span>
				{link && !ended && <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--bg-active-fill)] px-2 py-0.5 font-mono text-xs text-[var(--text-muted)]">
					<Clock size={12} />
					{t("chat.phoneCamera.expires", { time })}
				</span>}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{!ended && <button type="button" onClick={() => setShowQr(true)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border-divider)] bg-[var(--bg-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-active-fill)] active:scale-95">
					<QrCode size={12} />
					{t("chat.phoneCamera.showQr")}
				</button>}
				<button type="button" onClick={close} className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--status-error)] transition-all hover:bg-[color-mix(in_srgb,var(--status-error)_18%,transparent)] active:scale-95">
					<X size={12} />
					{t("chat.phoneCamera.end")}
				</button>
			</div>
		</div>
		{errors}
	</div>;
	return <Modal onClose={close} title={t("chat.phoneCamera.title")} icon={<Camera className="h-4 w-4 text-[var(--accent)]" />} size="none" className="w-full max-w-[440px]">
		<div ref={contentRef} className="space-y-4 overflow-y-auto p-5 text-sm">
			<div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--text-muted)]">
				<Wifi className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
				<p className="min-w-0 flex-1 leading-5 text-pretty">{t("chat.phoneCamera.warning")}</p>
			</div>
			<div role="status" className="flex flex-wrap items-center gap-2">
				<span className={clsx(
					"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
					status === "connected" && "bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] text-[var(--status-success)]",
					status === "receiving" && "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]",
					status === "waiting" && "bg-[color-mix(in_srgb,var(--status-warning)_16%,transparent)] text-[var(--status-warning)]",
					(status === "ended" || status === "starting") && "bg-[var(--bg-active-fill)] text-[var(--text-muted)]",
				)}>
					{status === "receiving" ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<span className={clsx(
							"h-1.5 w-1.5 rounded-full",
							status === "connected" && "bg-[var(--status-success)]",
							status === "waiting" && "bg-[var(--status-warning)] animate-pulse",
							(status === "ended" || status === "starting") && "bg-[var(--text-muted)]",
						)} />
					)}
					{t(`chat.phoneCamera.${status}`)}
				</span>
				<span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
					<ImagePlus size={12} className="shrink-0" />
					{t("chat.phoneCamera.added", { count })}
				</span>
				{link && !ended && <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--bg-active-fill)] px-2.5 py-1 font-mono text-xs text-[var(--text-muted)]">
					<Clock size={12} className="shrink-0" />
					{t("chat.phoneCamera.expires", { time })}
				</span>}
			</div>
			{link && !ended && <>
				<div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-well,rgba(0,0,0,0.1))] px-4 py-5">
					<div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 [&_svg]:block [&_svg]:h-48 [&_svg]:w-48" aria-label={t("chat.phoneCamera.link")} dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
					<p className="mt-3 select-none text-xs text-[var(--text-muted)]">{t("chat.phoneCamera.menuDesc")}</p>
				</div>
				<div className="space-y-1.5">
					<label className="block text-xs font-medium text-[var(--text-muted)]">{t("chat.phoneCamera.link")}</label>
					<div className="relative flex items-center">
						<input readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-lg border border-[var(--border-divider)] bg-[var(--bg-active-fill)] py-1.5 pl-3 pr-20 font-mono text-xs text-[var(--text)] transition-colors focus:border-[var(--accent)] focus:outline-none" />
						<button type="button" onClick={() => void copy()} className="absolute right-1.5 flex items-center gap-1 rounded-md bg-[var(--bg-hover)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-active-fill)] active:scale-95">
							{copied ? <Check size={12} className="text-[var(--status-success)]" /> : <Copy size={12} />}
							<span className="whitespace-nowrap">{t(copied ? "chat.phoneCamera.copied" : "chat.phoneCamera.copy")}</span>
						</button>
					</div>
				</div>
			</>}
			{errors}
			<div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
				{collapsedOnce.current && !ended && <button type="button" onClick={() => setShowQr(false)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition-all hover:bg-[var(--bg-hover)] active:scale-95">
					<EyeOff size={13} />
					{t("chat.phoneCamera.hideQr")}
				</button>}
				<button type="button" onClick={close} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--status-error)] transition-all hover:bg-[color-mix(in_srgb,var(--status-error)_18%,transparent)] active:scale-95">
					<X size={13} />
					{t("chat.phoneCamera.end")}
				</button>
			</div>
		</div>
	</Modal>;
}
