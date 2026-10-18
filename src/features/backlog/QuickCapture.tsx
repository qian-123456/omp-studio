import { Bug, Check, Lightbulb, ListTodo, Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BacklogKind, BacklogRef } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { onQuickCapture } from "../../lib/events";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { backlogAdd } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";
import { CaptureProjectSelect } from "./CaptureProjectSelect";
import { AddImageButton, ImageThumbs, useImageAttach } from "./IdeaImages";
import { resolveCaptureProject } from "./ideasLogic";

const KIND_META: Record<
	BacklogKind,
	{ label: string; icon: typeof Lightbulb; color: string }
> = {
	todo: {
		label: "待办",
		icon: ListTodo,
		color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
	},
	bug: {
		label: "缺陷",
		icon: Bug,
		color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
	},
	idea: {
		label: "想法",
		icon: Lightbulb,
		color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
	},
};

/**
 * [D] Global quick-capture modal. Always mounted; listens to global shortcut
 * `quick-capture` and renders when `ui.modal?.name === "quick-capture"`.
 */
export function QuickCapture() {
	const modal = useUi((s) => s.modal);
	const openModal = useUi((s) => s.openModal);
	const closeModal = useUi((s) => s.closeModal);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);

	const isVisible = modal?.name === "quick-capture";
	const initialText = typeof modal?.props?.text === "string" ? modal.props.text : "";
	const targetSessionId =
		typeof modal?.props?.sessionId === "string"
			? modal.props.sessionId
			: selectedSessionId;

	// Input lives in the store (localStorage) so an HMR/page reload keeps unsaved text.
	const { text, kind, images } = useBacklog((s) => s.captureDraft);
	const setCaptureDraft = useBacklog((s) => s.setCaptureDraft);
	const setText = (t: string) => setCaptureDraft({ text: t });
	const setKind = (k: BacklogKind) => setCaptureDraft({ kind: k });
	const [attachSession, setAttachSession] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const inputRef = useRef<HTMLInputElement>(null);
	// Explicit cancel (button / Esc) discards the persisted input; backdrop click keeps it.
	const cancel = () => {
		useBacklog.getState().clearCaptureDraft();
		closeModal();
	};
	useEscapeKey(cancel, isVisible);
	const attach = useImageAttach((paths) => {
		const cur = useBacklog.getState().captureDraft.images;
		setCaptureDraft({ images: [...cur, ...paths.filter((p) => !cur.includes(p))] });
	});

	// Listen to global quick-capture shortcut event from Tauri
	useEffect(() => {
		const unlisten = onQuickCapture(() => {
			openModal("quick-capture");
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, [openModal]);

	// Initialize text and focus input on open
	useEffect(() => {
		if (isVisible) {
			// Explicit prefill wins; otherwise restore the persisted unsaved input.
			if (initialText) useBacklog.getState().setCaptureDraft({ text: initialText });
			setError(null);
			setSubmitting(false);
			setTimeout(() => {
				inputRef.current?.focus();
			}, 50);
		}
	}, [isVisible, initialText]);

	if (!isVisible) return null;

	const currentSession = targetSessionId ? sessions[targetSessionId] : undefined;

	const handleSubmit = async (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		const trimmed = text.trim();
		if (!trimmed && images.length === 0) return;
		setSubmitting(true);
		setError(null);
		try {
			const refs: BacklogRef[] = [];
			if (attachSession && targetSessionId) {
				refs.push({ kind: "session", sessionId: targetSessionId, path: null, text: null, lines: null });
			}
			for (const path of images) {
				refs.push({ kind: "image", path, text: null, lines: null, sessionId: null });
			}
			await backlogAdd(
				trimmed || "（图片）",
				kind,
				refs,
				resolveCaptureProject(useBacklog.getState().captureProject, currentSession?.cwd ?? null),
			);
			useBacklog.getState().clearCaptureDraft();
			toast.success("已记入收集箱");
			closeModal();
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`保存失败: ${msg}`);
			setSubmitting(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-start justify-center bg-[var(--overlay)] pt-24 backdrop-blur-xs"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				className="w-[520px] rounded-2xl bg-[var(--bg-panel)] p-5 shadow-apple-modal hairline"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/20 text-xs font-bold text-amber-300">
							⚡
						</span>
						<h2 className="text-sm font-semibold text-neutral-100">
							快速捕获到收集箱
						</h2>
					</div>
					<button
						type="button"
						onClick={closeModal}
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{error && (
					<div className="mb-3 rounded-lg border border-rose-800/50 bg-rose-950/20 p-2 text-xs text-rose-300">
						{error}
					</div>
				)}

				<form
					onSubmit={handleSubmit}
					{...attach.dropProps}
					className={`space-y-3 rounded-lg ${attach.dragging ? "outline-dashed outline-1 outline-amber-500" : ""}`}
				>
					<input
						ref={inputRef}
						autoFocus
						type="text"
						value={text}
						onChange={(e) => setText(e.target.value)}
						onPaste={attach.onPaste}
						placeholder="记下一句话想法、待办或缺陷，可粘贴/拖入图片..."
						className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:ring-1 focus:ring-amber-500 focus:outline-none transition-all"
						onKeyDown={(e) => {
							if (isComposing(e)) {
								if (e.key === "Enter") e.preventDefault();
								return;
							}
							if (e.key === "Enter") {
								e.preventDefault();
								void handleSubmit();
							}
						}}
					/>

					<ImageThumbs paths={images} onRemove={(p) => setCaptureDraft({ images: images.filter((x) => x !== p) })} />

					<div className="flex items-center justify-between pt-1">
						{/* Kind Selector */}
						<div className="flex items-center gap-1.5">
							{(["todo", "bug", "idea"] as BacklogKind[]).map((k) => {
								const meta = KIND_META[k];
								const Icon = meta.icon;
								const isSelected = kind === k;
								return (
									<button
										key={k}
										type="button"
										onClick={() => {
											setKind(k);
											useBacklog.getState().setLastKind(k);
										}}
										className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
											isSelected
												? meta.color
												: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)]"
										}`}
									>
										<Icon className="h-3 w-3" />
										<span>{meta.label}</span>
									</button>
								);
							})}
							<AddImageButton
								onClick={attach.pick}
								className="flex items-center gap-1 rounded-full hairline bg-[var(--well-bg)] px-2.5 py-0.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)]"
							/>
							{attach.fileInput}
						</div>

						{/* Session Ref Toggle */}
						{targetSessionId && (
							<label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-300">
								<input
									type="checkbox"
									checked={attachSession}
									onChange={(e) => setAttachSession(e.target.checked)}
									className="h-3 w-3 rounded border-neutral-700 bg-neutral-800 text-amber-500 focus:ring-0"
								/>
								<MessageSquare className="h-3 w-3 text-neutral-500" />
								<span className="max-w-[120px] truncate">
									{currentSession?.title || targetSessionId}
								</span>
							</label>
						)}
					</div>
					<CaptureProjectSelect currentProject={currentSession?.cwd ?? null} />

					<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
						<button
							type="button"
							onClick={cancel}
							className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
						>
							取消 (Esc)
						</button>
						<button
							type="submit"
							disabled={submitting || (!text.trim() && images.length === 0)}
							className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40"
						>
							{submitting ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Check className="h-3.5 w-3.5" />
							)}
							<span>{submitting ? "保存中..." : "保存 (Enter)"}</span>
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
