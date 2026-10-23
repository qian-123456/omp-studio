import { toast } from "../lib/toast";
import { Check, ImageOff, Moon, Pipette, Sun, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { saveClipboardImage } from "../lib/ipc";
import {
	addCustomWallpaper,
	removeCustomWallpaper,
	setWallpaper,
	useCustomWallpapers,
	useWallpaperState,
} from "../lib/theme";
import {
	extractPaletteFromImage,
	PRESET_WALLPAPERS,
	type WallpaperAppearance,
	type WallpaperPalette,
	type WallpaperVariant,
} from "../lib/wallpaperPalette";

const VARIANTS: { key: WallpaperVariant; label: string }[] = [
	{ key: "mono", label: "纯灰" },
	{ key: "neutral", label: "中性" },
	{ key: "soft", label: "轻调" },
	{ key: "rich", label: "浓郁" },
];

interface CardData {
	id: string;
	name: string;
	url: string;
	thumb: string;
	palette: WallpaperPalette;
	appearance: WallpaperAppearance;
	custom: boolean;
}

function readFileAsBase64(file: File): Promise<string> {
	// Executor form: project lib target predates Promise.withResolvers.
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const result = String(reader.result ?? "");
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

function ColorDots({ palette }: { palette: WallpaperPalette }) {
	const state = useWallpaperState();
	return (
		<div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
			{VARIANTS.map((v) => {
				const active = state.variant === v.key;
				return (
					<button
						key={v.key}
						type="button"
						title={v.label}
						aria-label={v.label}
						className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
							active
								? "border-[var(--accent,#3b82f6)] bg-[var(--accent,#3b82f6)]/15 text-[var(--accent,#3b82f6)] shadow-xs"
								: "border-black/10 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"
						}`}
						onClick={() => setWallpaper({ accentColor: palette[v.key], variant: v.key })}
					>
						<span
							className="h-2.5 w-2.5 rounded-full ring-1 ring-black/20"
							style={{ backgroundColor: palette[v.key] }}
						/>
						<span>{v.label}</span>
					</button>
				);
			})}
			<label
				title="自定义取色"
				className={`relative flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
					state.variant === "custom"
						? "border-[var(--accent,#3b82f6)] bg-[var(--accent,#3b82f6)]/15 text-[var(--accent,#3b82f6)] shadow-xs"
						: "border-black/10 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25"
				}`}
			>
				<Pipette className="h-3 w-3" />
				<span>自定义</span>
				<input
					type="color"
					className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
					value={/^#[0-9a-f]{6}$/i.test(state.accentColor) ? state.accentColor : "#888888"}
					onChange={(e) => setWallpaper({ accentColor: e.target.value, variant: "custom" })}
				/>
			</label>
		</div>
	);
}

export function WallpaperPicker() {
	const state = useWallpaperState();
	const customs = useCustomWallpapers();
	const fileRef = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);

	const cards: CardData[] = [
		...PRESET_WALLPAPERS.map((p) => ({
			id: p.id,
			name: p.name,
			url: p.imageUrl,
			thumb: p.thumbnailUrl,
			palette: p.palette,
			appearance: p.appearance,
			custom: false,
		})),
		...customs.map((c) => ({
			id: c.id,
			name: c.name,
			url: c.url,
			thumb: c.url,
			palette: c.palette,
			appearance: c.appearance || (c.palette.appearance ?? "dark"),
			custom: true,
		})),
	];

	const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		setUploading(true);
		try {
			const b64 = await readFileAsBase64(file);
			const dataUrl = `data:${file.type || "image/jpeg"};base64,${b64}`;
			let path: string | undefined;
			try {
				path = await saveClipboardImage(b64);
			} catch {
				path = undefined;
			}
			const palette = await extractPaletteFromImage(dataUrl);
			const id = `custom-${Date.now()}`;
			const app: WallpaperAppearance = palette.appearance ?? "dark";
			addCustomWallpaper({ id, name: file.name.replace(/\.[^.]+$/, ""), url: dataUrl, path, palette, appearance: app, createdAt: Date.now() });
			setWallpaper({ enabled: true, id, url: dataUrl, accentColor: palette.soft, variant: "soft", appearance: app });
		} catch (err) {
			console.error("upload wallpaper failed", err);
			toast.error("壁纸图片解析失败，请尝试其他图片");
			setUploading(false);
		}
	};

	const selectCard = (c: CardData) => {
		const variant: WallpaperVariant = state.variant === "custom" ? "soft" : state.variant;
		setWallpaper({
			enabled: true,
			id: c.id,
			url: c.url,
			accentColor: c.palette[variant],
			variant,
			appearance: c.appearance,
		});
	};

	const activeCard = cards.find((c) => c.id === state.id);
	const noneActive = !state.enabled || state.id === "none";
	const cardBase =
		"group relative aspect-[16/10] cursor-pointer overflow-hidden rounded-xl border text-left transition shadow-sm";
	const activeCls = "border-transparent ring-2 ring-[var(--accent,#3b82f6)]";
	const idleCls = "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30";
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2.5">
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-1.5">
						<span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">毛玻璃风格</span>
						<div className="flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
							{(
								[
									["dark", "深色黑晶"],
									["light", "浅色冰晶"],
								] as const
							).map(([key, label]) => {
								const isCurrent = (state.appearance ?? "dark") === key;
								return (
									<button
										key={key}
										type="button"
										className={`flex items-center gap-1 rounded px-2.5 py-1 transition ${
											isCurrent
												? "bg-[var(--accent,#3b82f6)]/15 text-[var(--accent,#3b82f6)] shadow-xs"
												: "opacity-70 hover:opacity-100"
										}`}
										onClick={() => setWallpaper({ appearance: key })}
									>
										{key === "dark" ? <Moon size={12} /> : <Sun size={12} />}
										<span>{label}</span>
									</button>
								);
							})}
						</div>
					</div>

					<div className="flex items-center gap-1.5">
						<span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">亮度</span>
						<div className="flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
							{(
								[
									[0.85, "微暗 85%"],
									[1.0, "原画 100%"],
									[1.15, "提亮 115%"],
									[1.25, "明艳 125%"],
								] as const
							).map(([b, label]) => {
								const isCurrent = Math.abs((state.brightness ?? 1.0) - b) < 0.04;
								return (
									<button
										key={b}
										type="button"
										className={`rounded px-2 py-1 transition ${
											isCurrent
												? "bg-[var(--accent,#3b82f6)]/15 text-[var(--accent,#3b82f6)] shadow-xs"
												: "opacity-70 hover:opacity-100"
										}`}
										onClick={() => setWallpaper({ brightness: b })}
									>
										{label}
									</button>
								);
							})}
						</div>
					</div>

					<div className="flex items-center gap-1.5">
						<span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">衬光薄纱</span>
						<div className="flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
							{(
								[
									["none", "无"],
									["white", "白霜 ☀️"],
									["black", "暗影 🌙"],
								] as const
							).map(([v, label]) => {
								const currentVeil = state.veil ?? (state.appearance === "light" ? "white" : "none");
								const isCurrent = currentVeil === v;
								return (
									<button
										key={v}
										type="button"
										className={`rounded px-2 py-1 transition ${
											isCurrent
												? "bg-[var(--accent,#3b82f6)]/15 text-[var(--accent,#3b82f6)] shadow-xs"
												: "opacity-70 hover:opacity-100"
										}`}
										onClick={() => setWallpaper({ veil: v })}
									>
										{label}
									</button>
								);
							})}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<div className="flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
						{(
							[
								["clear", "高清原画"],
								["soft", "轻度柔焦"],
								["blur", "深度虚化"],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								className={`rounded px-2.5 py-1 ${state.effect === key ? "bg-black/10 dark:bg-white/15" : "opacity-70 hover:opacity-100"}`}
								onClick={() => setWallpaper({ effect: key })}
							>
								{label}
							</button>
						))}
					</div>
					<button
						type="button"
						disabled={uploading}
						className="flex items-center gap-1 rounded-md border border-black/10 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
						onClick={() => fileRef.current?.click()}
					>
						<Upload className="h-3.5 w-3.5" />
						{uploading ? "上传中…" : "上传图片"}
					</button>
					<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile} />
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
				<div
					role="button"
					tabIndex={0}
					className={`${cardBase} flex flex-col items-center justify-center gap-1.5 bg-black/5 dark:bg-neutral-900/60 ${noneActive ? activeCls : idleCls}`}
					onClick={() => setWallpaper({ enabled: false, id: "none" })}
				>
					<ImageOff className="h-5 w-5 opacity-40" />
					<span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">无壁纸 · 纯色</span>
					{noneActive && <CheckBadge />}
				</div>
				{cards.map((c) => {
					const active = state.enabled && state.id === c.id;
					return (
						<div
							key={c.id}
							role="button"
							tabIndex={0}
							className={`${cardBase} bg-neutral-800/80 ${active ? activeCls : idleCls}`}
							onClick={() => selectCard(c)}
						>
							<img
								src={c.thumb}
								alt=""
								className="absolute inset-0 h-full w-full object-cover transition-opacity duration-200"
								draggable={false}
							/>
							<div className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-between bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2.5 pb-0.5 text-xs text-white">
								<span className="truncate font-medium">{c.name}</span>
							</div>
							{active && <CheckBadge />}
							{c.custom && (
								<button
									type="button"
									title="删除"
									className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white/80 hover:bg-red-600 hover:text-white backdrop-blur-sm"
									onClick={(e) => {
										e.stopPropagation();
										removeCustomWallpaper(c.id);
									}}
								>
									<Trash2 className="h-3 w-3" />
								</button>
							)}
						</div>
					);
				})}
			</div>
			{cards.length === 0 && (
				<p className="text-xs text-neutral-500 dark:text-neutral-400">
					没有内置壁纸。点右上角「上传图片」，用自己的图片作为壁纸。
				</p>
			)}
			{state.enabled && state.id !== "none" && activeCard && (
				<div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-black/10 bg-black/[0.03] p-2.5 text-xs dark:border-white/10 dark:bg-white/[0.04]">
					<div className="flex items-center gap-1.5 font-medium text-neutral-600 dark:text-neutral-300">
						<span>强调色搭配</span>
						<span className="text-[11px] text-neutral-400 dark:text-neutral-500">（从壁纸提取）</span>
					</div>
					<ColorDots palette={activeCard.palette} />
				</div>
			)}
		</div>
	);
}

function CheckBadge() {
	return (
		<span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent,#0A84FF)] text-white shadow-md ring-1 ring-black/30">
			<Check className="h-3 w-3 stroke-[2.5]" />
		</span>
	);
}
