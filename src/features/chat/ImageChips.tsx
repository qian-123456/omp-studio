import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { ImageIcon, ZoomIn } from "lucide-react";
import { useState } from "react";
import type { ImageAttachment } from "../../lib/contracts";

export function ImageChip({ image }: { image: ImageAttachment }) {
	const [expanded, setExpanded] = useState(false);
	const hasPath = Boolean(image.path);
	const src = hasPath && image.path ? convertFileSrc(image.path) : null;

	const label =
		image.width && image.height
			? `${image.width}×${image.height}`
			: image.marker ?? "图片";

	return (
		<>
			<button
				type="button"
				onClick={() => {
					if (hasPath && image.path) {
						setExpanded(true);
					}
				}}
				className="group/img press-scale flex items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] p-1 pr-2 text-[11px] text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100"
				title={image.path ? `点击预览: ${image.path}` : label}
			>
				{src ? (
					<div className="relative h-7 w-7 shrink-0 overflow-hidden rounded bg-black/20">
						<img
							src={src}
							alt={label}
							className="h-full w-full object-cover"
							loading="lazy"
						/>
						<div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/img:opacity-100">
							<ZoomIn size={12} className="text-white" />
						</div>
					</div>
				) : (
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-neutral-800 text-neutral-400">
						<ImageIcon size={14} />
					</div>
				)}
				<span className="font-mono text-[10px] text-neutral-400 group-hover/img:text-neutral-200">
					{label}
				</span>
			</button>

			{/* Modal preview when clicked */}
			{expanded && src && image.path && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
					onClick={() => setExpanded(false)}
				>
					<div
						className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<img
							src={src}
							alt={label}
							className="max-h-[80vh] max-w-full rounded object-contain"
						/>
						<div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400">
							<span className="truncate max-w-xs">{image.path}</span>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => image.path && void openPath(image.path)}
									className="rounded px-2 py-0.5 hover:bg-neutral-800 hover:text-neutral-200"
								>
									在系统查看
								</button>
								<button
									type="button"
									onClick={() => setExpanded(false)}
									className="rounded px-2 py-0.5 hover:bg-neutral-800 hover:text-neutral-200"
								>
									关闭
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

export function ImageChipsList({ images }: { images?: ImageAttachment[] }) {
	if (!images || images.length === 0) return null;
	return (
		<div className="mb-1.5 flex flex-wrap items-center gap-1.5">
			{images.map((img) => (
				<ImageChip key={img.id} image={img} />
			))}
		</div>
	);
}
