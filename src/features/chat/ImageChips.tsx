import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getImageTokenPalette } from "./Composer";
import { baseName } from "./fileAttach";
import { errMsg } from "../../lib/dialogs";
import { validatePath } from "../../lib/ipc";
import { toast } from "../../lib/toast";

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

interface FileKind {
	label: string;
	bg: string;
}

/** Brand-ish colour + short glyph per document family (Word/Excel/PPT/PDF…). */
function fileKindOf(path: string): FileKind {
	const ext = (path.split(".").pop() ?? "").toLowerCase();
	if (/^docx?$|^rtf$|^pages$/.test(ext)) return { label: "W", bg: "#2B579A" };
	if (/^xlsx?$|^csv$|^numbers$/.test(ext)) return { label: "X", bg: "#217346" };
	if (/^pptx?$|^key$/.test(ext)) return { label: "P", bg: "#D24726" };
	if (ext === "pdf") return { label: "PDF", bg: "#D93025" };
	if (/^(zip|rar|7z|tar|gz|tgz)$/.test(ext)) return { label: "ZIP", bg: "#7A6A53" };
	if (/^(md|txt|log)$/.test(ext)) return { label: "TXT", bg: "#6B7280" };
	return { label: ext ? ext.slice(0, 4).toUpperCase() : "FILE", bg: "#6B7280" };
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

/** Non-image attachment card (📎#N): file name (two lines max) + size on the
 * left, coloured file-type tile on the right; click opens the file in the
 * system default app. */
export function FileChip({
	path,
	name,
	variant,
	onOpen,
	onRemove,
}: {
	path: string;
	/** 1-based attachment number (matches the `📎#n` token). */
	index: number;
	name?: string;
	variant: "strip" | "inline" | "bubble";
	onOpen?: () => void;
	onRemove?: () => void;
}) {
	const [size, setSize] = useState<number | null>(null);
	useEffect(() => {
		let alive = true;
		void validatePath(path)
			.then((c) => {
				if (alive && c.exists && !c.isDir) setSize(c.size);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [path]);
	const kind = fileKindOf(path);
	const open = () => {
		if (onOpen) {
			onOpen();
			return;
		}
		void openPath(path).catch((e: unknown) =>
			toast.error(`打开文件失败: ${errMsg(e)}`),
		);
	};
	const compact = variant === "inline";
	return (
		<div
			className={clsx(
				"group/thumb relative flex shrink-0 cursor-pointer select-none items-center gap-3 border border-[var(--line)] bg-[var(--bg-panel)]",
				compact ? "h-9 max-w-[200px] rounded-lg px-2" : "w-[240px] rounded-xl px-3 py-2",
			)}
			onClick={open}
			title={path}
		>
			<div className="flex min-w-0 flex-1 flex-col leading-snug">
				<span
					className={clsx(
						"font-medium text-[var(--text)] [overflow-wrap:anywhere]",
						compact ? "truncate text-[12px]" : "line-clamp-2 text-[13px]",
					)}
				>
					{name || baseName(path)}
				</span>
				{!compact && size !== null && (
					<span className="mt-0.5 text-[11px] text-[var(--text-40)]">{formatBytes(size)}</span>
				)}
			</div>
			<div
				className={clsx(
					"flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
					compact ? "h-6 w-6 text-[10px]" : "h-10 w-10 text-[15px]",
				)}
				style={{ backgroundColor: kind.bg }}
			>
				{kind.label}
			</div>
			{onRemove && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 opacity-0 transition-opacity duration-150 hover:bg-black hover:text-white group-hover/thumb:opacity-100"
					title="移除文件"
				>
					<X size={10} strokeWidth={2.5} />
				</button>
			)}
		</div>
	);
}
