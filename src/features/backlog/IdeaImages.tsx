import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { ImagePreviewModal } from "../../components/ImagePreviewModal";
import { errMsg } from "../../lib/dialogs";
import { saveClipboardImage } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useT, tNow } from "../../stores/language";

function fileToBase64(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const comma = result.indexOf(",");
			resolve(comma !== -1 ? result.slice(comma + 1) : result);
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/**
 * Paste / drop / file-picker handlers that save images via `saveClipboardImage`
 * and report saved paths through `onAdd`.
 */
export function useImageAttach(onAdd: (paths: string[]) => void) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);

	const save = async (blobs: Blob[]) => {
		const paths: string[] = [];
		for (const blob of blobs) {
			try {
				paths.push(await saveClipboardImage(await fileToBase64(blob)));
			} catch (err) {
				toast.error(tNow("backlog.processImageFailed", { error: errMsg(err) }));
			}
		}
		if (paths.length > 0) onAdd(paths);
	};

	const imagesOf = (files: Iterable<File>) => [...files].filter((f) => f.type.startsWith("image/"));

	return {
		dragging,
		fileInputRef,
		onPaste: (e: React.ClipboardEvent) => {
			const blobs = [...(e.clipboardData?.items ?? [])]
				.filter((it) => it.type.startsWith("image/"))
				.flatMap((it) => {
					const f = it.getAsFile();
					return f ? [f] : [];
				});
			if (blobs.length === 0) return;
			e.preventDefault();
			void save(blobs);
		},
		dropProps: {
			onDragOver: (e: React.DragEvent) => {
				if (![...e.dataTransfer.types].includes("Files")) return;
				e.preventDefault();
				setDragging(true);
			},
			onDragLeave: (e: React.DragEvent) => {
				if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
				setDragging(false);
			},
			onDrop: (e: React.DragEvent) => {
				setDragging(false);
				const files = imagesOf(e.dataTransfer.files);
				if (e.dataTransfer.files.length === 0) return;
				e.preventDefault();
				if (files.length === 0) {
					toast.error(tNow("backlog.onlyImageFilesSupported"));
					return;
				}
				void save(files);
			},
		},
		fileInput: (
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				multiple
				hidden
				onChange={(e) => {
					const files = imagesOf(e.target.files ?? []);
					e.target.value = "";
					void save(files);
				}}
			/>
		),
		pick: () => fileInputRef.current?.click(),
	};
}

export function AddImageButton({ onClick, className }: { onClick: () => void; className?: string }) {
	const { t } = useT();
	return (
		<button type="button" onClick={onClick} className={className} title={t("backlog.addImageTitle")}>
			<ImagePlus className="h-3.5 w-3.5" />
			<span>{t("backlog.addImage")}</span>
		</button>
	);
}

/** Thumbnails; click opens a full-size preview. `onRemove` adds an X per image. */
export function ImageThumbs({
	paths,
	onRemove,
	size = "h-12 w-12",
}: {
	paths: string[];
	onRemove?: (path: string) => void;
	size?: string;
}) {
	const { t } = useT();
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	if (paths.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5">
			{paths.map((p) => (
				<div key={p} className={`group relative ${size} shrink-0`}>
					<button
						type="button"
						onClick={() => setPreviewIndex(paths.indexOf(p))}
						className="h-full w-full overflow-hidden rounded-md border border-[var(--border-divider)] bg-[var(--bg)]"
						title={p}
					>
						<img src={convertFileSrc(p)} alt="" className="h-full w-full object-cover" />
					</button>
					{onRemove && (
						<button
							type="button"
							onClick={() => onRemove(p)}
							className="absolute -right-1 -top-1 rounded-full bg-neutral-900 p-0.5 text-neutral-300 hover:text-rose-400"
							title={t("backlog.removeImage")}
						>
							<X className="h-2.5 w-2.5" />
						</button>
					)}
				</div>
			))}
			{previewIndex !== null && (
				<ImagePreviewModal
					images={paths.map((p, idx) => ({
						path: p,
						marker: t("backlog.imageMarker", { index: idx + 1 }),
					}))}
					initialIndex={previewIndex}
					onClose={() => setPreviewIndex(null)}
				/>
			)}
		</div>
	);
}
