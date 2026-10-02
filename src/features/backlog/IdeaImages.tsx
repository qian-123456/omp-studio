import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { errMsg } from "../../lib/dialogs";
import { saveClipboardImage } from "../../lib/ipc";
import { toast } from "../../lib/toast";

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
				toast.error(`处理图片失败: ${errMsg(err)}`);
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
					toast.error("仅支持图片文件");
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
	return (
		<button type="button" onClick={onClick} className={className} title="添加图片（也可粘贴或拖入）">
			<ImagePlus className="h-3.5 w-3.5" />
			<span>添加图片</span>
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
	const [preview, setPreview] = useState<string | null>(null);
	if (paths.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1.5">
			{paths.map((p) => (
				<div key={p} className={`group relative ${size} shrink-0`}>
					<button
						type="button"
						onClick={() => setPreview(p)}
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
							title="移除图片"
						>
							<X className="h-2.5 w-2.5" />
						</button>
					)}
				</div>
			))}
			{preview && (
				<FloatingLayer
					anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
					placement="bottom-start"
					layer="modal"
					onDismiss={() => setPreview(null)}
					className="-translate-x-1/2 -translate-y-1/2 p-2 shadow-apple-modal"
				>
					<div className="relative">
						<img
							src={convertFileSrc(preview)}
							alt={preview}
							className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain"
						/>
						<button
							type="button"
							onClick={() => setPreview(null)}
							className="absolute right-1 top-1 rounded-full bg-neutral-900/80 p-1 text-neutral-200 hover:text-white"
							title="关闭预览"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</FloatingLayer>
			)}
		</div>
	);
}
