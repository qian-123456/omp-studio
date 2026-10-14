import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, ListChecks, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Z_LAYER } from "../../../components/FloatingLayer";
import { errMsg } from "../../../lib/dialogs";
import { useEscapeKey } from "../../../lib/hooks";
import { saveShareImage } from "../../../lib/ipc";
import { sessionDisplayName } from "../../../lib/sessionName";
import { toast } from "../../../lib/toast";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { ShareCard } from "./ShareCard";
import { renderShareImage, type ShareImage } from "./renderShareImage";
import { buildShareEntries, type ShareEntry } from "./shareEntries";
import { useShareSelection } from "./shareStore";

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(d: Date): string {
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Preview + export dialog for "share as image". Always mounted; opened with
 * `ui.openModal("share-image", { sessionId, itemIds })`.
 */
export function ShareImageDialog() {
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const isVisible = modal?.name === "share-image";
	const sessionId = typeof modal?.props?.sessionId === "string" ? modal.props.sessionId : "";
	const itemIds = useMemo(
		() => (Array.isArray(modal?.props?.itemIds) ? (modal.props.itemIds as string[]) : []),
		[modal?.props?.itemIds],
	);
	const session = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined));
	const title = session ? sessionDisplayName(session) : "对话";

	const [entries, setEntries] = useState<ShareEntry[]>([]);
	const [image, setImage] = useState<ShareImage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"copy" | "save" | null>(null);
	const [dateLabel, setDateLabel] = useState("");
	const cardRef = useRef<HTMLDivElement>(null);

	useEscapeKey(closeModal, isVisible);

	// Snapshot the selected messages when the dialog opens.
	useEffect(() => {
		if (!isVisible) {
			setEntries([]);
			setImage(null);
			setError(null);
			return;
		}
		const items = useLive.getState().sessions[sessionId]?.items ?? [];
		setImage(null);
		setError(null);
		setDateLabel(new Date().toLocaleString("zh-CN", { hour12: false }));
		setEntries(buildShareEntries(items, new Set(itemIds)));
	}, [isVisible, sessionId, itemIds]);

	// Rasterise once the off-screen card has been laid out.
	useEffect(() => {
		if (!isVisible || entries.length === 0) return;
		let cancelled = false;
		const timer = window.setTimeout(async () => {
			const node = cardRef.current;
			if (!node) return;
			try {
				const img = await renderShareImage(node);
				if (!cancelled) setImage(img);
			} catch (e) {
				if (!cancelled) setError(errMsg(e));
			}
		}, 80);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [isVisible, entries, dateLabel]);

	if (!isVisible) return null;

	const copyImage = async () => {
		if (!image || busy) return;
		setBusy("copy");
		try {
			await writeImage(image.bytes);
			toast.success("已复制图片");
		} catch (e) {
			toast.error(`复制图片失败: ${errMsg(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const saveImage = async () => {
		if (!image || busy) return;
		setBusy("save");
		try {
			const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
			const path = await save({
				title: "保存图片",
				defaultPath: `${safeTitle}-${stamp(new Date())}.png`,
				filters: [{ name: "PNG 图片", extensions: ["png"] }],
			});
			if (!path) return;
			await saveShareImage(image.base64, path.toLowerCase().endsWith(".png") ? path : `${path}.png`);
			toast.success("已保存图片");
		} catch (e) {
			toast.error(`保存图片失败: ${errMsg(e)}`);
		} finally {
			setBusy(null);
		}
	};

	const continueSelecting = () => {
		useShareSelection.getState().begin(sessionId, itemIds);
		closeModal();
	};

	return (
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeModal();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="share-image-title"
				className="flex max-h-[min(92vh,860px)] w-full max-w-[560px] flex-col rounded-2xl bg-[var(--bg-panel)] p-5 text-[var(--text)] shadow-apple-modal hairline"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex shrink-0 items-center justify-between">
					<div>
						<h2 id="share-image-title" className="text-sm font-semibold">
							分享为图片
						</h2>
						{entries.length > 0 && (
							<p className="mt-0.5 text-[11px] text-[var(--text-40)]">共 {entries.length} 条消息</p>
						)}
					</div>
					<button
						type="button"
						onClick={closeModal}
						aria-label="关闭"
						className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
					>
						<X size={15} />
					</button>
				</div>

				<div className="min-h-[160px] flex-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-hover)]/40 p-3">
					{entries.length === 0 ? (
						<div className="flex h-40 items-center justify-center text-xs text-[var(--text-40)]">
							没有可分享的内容
						</div>
					) : error ? (
						<div className="flex h-40 items-center justify-center px-6 text-center text-xs text-rose-400">
							{error}
						</div>
					) : image ? (
						<img
							src={image.dataUrl}
							alt="分享预览"
							className="mx-auto block w-full rounded-lg shadow-sm"
							draggable={false}
						/>
					) : (
						<div className="flex h-40 items-center justify-center gap-2 text-xs text-[var(--text-40)]">
							<Loader2 size={14} className="animate-spin" />
							正在生成图片…
						</div>
					)}
				</div>

				<div className="mt-4 flex shrink-0 items-center justify-between gap-2">
					<button
						type="button"
						onClick={continueSelecting}
						className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
					>
						<ListChecks size={14} />
						选择更多消息
					</button>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void copyImage()}
							disabled={!image || busy !== null}
							className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--ghost-hover)] disabled:cursor-not-allowed disabled:opacity-40"
						>
							{busy === "copy" ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
							复制图片
						</button>
						<button
							type="button"
							onClick={() => void saveImage()}
							disabled={!image || busy !== null}
							className="flex items-center gap-1.5 rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-[var(--bg-panel)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
							保存图片
						</button>
					</div>
				</div>
			</div>

			{/* Off-screen render target (kept laid out so fonts/layout match the preview). */}
			<div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0">
				{entries.length > 0 && <ShareCard ref={cardRef} title={title} dateLabel={dateLabel} entries={entries} />}
			</div>
		</div>
	);
}
