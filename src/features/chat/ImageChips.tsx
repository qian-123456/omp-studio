import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { ImageOff, X } from "lucide-react";
import { useState } from "react";
import { getImageTokenPalette } from "./Composer";

/**
 * The single render path for image attachments (composer strip + sent user
 * bubble). Codex-style: compact rounded thumbnail, object-cover. A path that
 * fails to load (deleted file, outside the asset-protocol scope) collapses to
 * a compact icon+label chip — never an empty sized box.
 */
export function AttachmentThumb({
	path,
	index,
	showIndex,
	variant,
	onOpen,
	onRemove,
}: {
	path: string;
	/** 1-based attachment number (matches the `#n` token). */
	index: number;
	showIndex?: boolean;
	/** `strip`: composer chip (48px); `inline`: annotation pill (32px); `bubble`: sent message (≤200px). */
	variant: "strip" | "inline" | "bubble";
	onOpen?: () => void;
	onRemove?: () => void;
}) {
	const [failed, setFailed] = useState(false);
	const label = `图片 #${index}`;
	const palette = getImageTokenPalette(index);

	const removeBtn = onRemove && (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onRemove();
			}}
			className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 opacity-0 transition-opacity duration-150 hover:bg-black hover:text-white group-hover/thumb:opacity-100"
			title="移除图片"
		>
			<X size={10} strokeWidth={2.5} />
		</button>
	);

	if (failed) {
		return (
			<div
				className="group/thumb relative flex h-8 shrink-0 select-none items-center gap-1.5 rounded-lg border border-[var(--line)] px-2 pr-5 text-[12px] text-[var(--text-40)]"
				title={`无法加载图片：${path}`}
			>
				<ImageOff size={13} className="shrink-0" />
				<span>{label}</span>
				{removeBtn}
			</div>
		);
	}

	return (
		<div
			className={clsx(
				"group/thumb relative shrink-0 cursor-pointer select-none overflow-hidden border border-[var(--line)]",
				variant === "strip"
					? "h-12 w-12 rounded-lg"
					: variant === "inline"
						? "h-8 w-8 rounded"
						: "h-20 w-20 rounded-xl",
			)}
			onClick={onOpen}
			title={onOpen ? "点击放大查看" : label}
		>
			<img
				src={convertFileSrc(path)}
				alt={label}
				loading="lazy"
				draggable={false}
				onError={() => setFailed(true)}
				className="block h-full w-full object-cover"
			/>
			<div className="pointer-events-none absolute inset-0 bg-white/15 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100" />
			{showIndex && (
				<span
					className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[10px] font-bold leading-4"
					style={{ color: palette.hex }}
				>
					#{index}
				</span>
			)}
			{removeBtn}
		</div>
	);
}
