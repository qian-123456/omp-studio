/**
 * Theme picker: a single flat surface — mode tabs (深色 / 浅色 / 跟随系统)
 * on top, with the matching theme list expanded inline below. 跟随系统 is
 * the default mode and shows the day/night pair used while following the
 * system. Shared by the top-bar popover (compact) and the appearance
 * settings section (full size).
 */
import { Image as ImageIcon, Monitor, Moon, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
	THEMES,
	setSystemDarkTheme,
	setSystemLightTheme,
	setTheme,
	setWallpaper,
	themeById,
	useSystemDarkTheme,
	useSystemLightTheme,
	useThemeChoice,
	useWallpaperState,
	type ThemeChoice,
	type ThemeDef,
} from "../lib/theme";
import { PRESET_WALLPAPERS } from "../lib/wallpaperPalette";
import { WallpaperPicker } from "./WallpaperPicker";

type ModeTab = "dark" | "light" | "system" | "wallpaper";

function ThemeCard({
	theme,
	active,
	onSelect,
	small,
}: {
	theme: ThemeDef;
	active: boolean;
	onSelect: (id: string) => void;
	small?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(theme.id)}
			title={theme.name}
			aria-pressed={active}
			className={`rounded-lg border p-2 text-left transition-colors ${
				active
					? "border-amber-500 ring-1 ring-amber-500/40"
					: "border-[var(--border-divider)] hover:border-neutral-500"
			}`}
		>
			<span
				className={`block w-full overflow-hidden rounded border border-black/20 ${
					small ? "h-7" : "h-10"
				}`}
				style={{ backgroundColor: theme.swatch.bg }}
				aria-hidden
			>
				<span
					className={`mt-1 ml-1 block rounded-sm ${
						small ? "h-2 w-7" : "h-3 w-9"
					}`}
					style={{ backgroundColor: theme.swatch.panel }}
				>
					<span
						className={`mt-1 ml-1 block rounded-full ${
							small ? "h-1 w-3" : "h-1.5 w-4"
						}`}
						style={{ backgroundColor: theme.swatch.accent }}
					/>
				</span>
			</span>
			<span className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-300">
				<span className="truncate">{theme.name}</span>
				{active && (
					<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
				)}
			</span>
		</button>
	);
}

export function ThemePicker({ compact = false }: { compact?: boolean }) {
	const choice = useThemeChoice();
	const sysDark = useSystemDarkTheme();
	const sysLight = useSystemLightTheme();
	const wallpaper = useWallpaperState();
	const [tab, setTab] = useState<ModeTab>(() =>
		wallpaper.enabled
			? "wallpaper"
			: choice === "system"
				? "system"
				: themeById(choice)?.dark
					? "dark"
					: "light",
	);
	const cols = compact ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4";
	const card = (
		t: ThemeDef,
		active: boolean,
		onSelect: (id: string) => void,
	) => (
		<ThemeCard
			key={t.id}
			theme={t}
			active={active}
			onSelect={onSelect}
			small={compact}
		/>
	);

	const tabBtn = (
		id: ModeTab,
		icon: ReactNode,
		label: string,
		live: boolean,
	) => (
		<button
			type="button"
			onClick={() => {
				if (id === "wallpaper") {
					if (!wallpaper.enabled) {
						const hasSaved = wallpaper.id !== "none" && !!wallpaper.url;
						const fallback = PRESET_WALLPAPERS[0];
						// Without a saved wallpaper or a bundled preset there is nothing to show:
						// open the tab so the picker can offer an upload instead.
						if (hasSaved || fallback) {
							setWallpaper({
								enabled: true,
								id: hasSaved ? wallpaper.id : fallback.id,
								url: hasSaved ? wallpaper.url : fallback.imageUrl,
								accentColor: wallpaper.accentColor || fallback?.palette.soft || "#5a7a9a",
								variant: wallpaper.variant || "soft",
							});
						}
					}
				} else {
					if (wallpaper.enabled) {
						setWallpaper({ enabled: false });
					}
					if (id === "system") {
						setTheme("system");
					}
				}
				setTab(id);
			}}
			aria-pressed={tab === id}
			title={live ? `${label}（当前使用中）` : label}
			className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
				tab === id
					? "bg-[var(--bg-active-fill)] text-neutral-100 shadow-sm"
					: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
			}`}
		>
			{icon}
			<span className="whitespace-nowrap">{label}</span>
			{live && (
				<span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
			)}
		</button>
	);

	const chosen = choice === "system" ? undefined : themeById(choice);

	return (
		<div>
			<div className="flex rounded-lg hairline bg-[var(--well-bg)] p-0.5">
				{tabBtn("dark", <Moon size={13} />, "深色", !wallpaper.enabled && chosen?.dark === true)}
				{tabBtn("light", <Sun size={13} />, "浅色", !wallpaper.enabled && chosen != null && !chosen.dark)}
				{tabBtn("system", <Monitor size={13} />, "跟随系统", !wallpaper.enabled && choice === "system")}
				{tabBtn("wallpaper", <ImageIcon size={13} />, "背景主题", wallpaper.enabled)}
			</div>
			{tab === "dark" && (
				<div className={`mt-2 grid gap-2 ${cols}`}>
					{THEMES.filter((t) => t.dark).map((t) =>
						card(t, choice === t.id, (id) => setTheme(id as ThemeChoice)),
					)}
				</div>
			)}
			{tab === "light" && (
				<div className={`mt-2 grid gap-2 ${cols}`}>
					{THEMES.filter((t) => !t.dark).map((t) =>
						card(t, choice === t.id, (id) => setTheme(id as ThemeChoice)),
					)}
				</div>
			)}
			{tab === "system" && (
				<div className="mt-2 space-y-3">
					<div>
						<div className="text-[11px] font-medium text-neutral-400">
							白天（浅色）
						</div>
						<div className={`mt-1.5 grid gap-2 ${cols}`}>
							{THEMES.filter((t) => !t.dark).map((t) =>
								card(t, sysLight === t.id, setSystemLightTheme),
							)}
						</div>
					</div>
					<div>
						<div className="text-[11px] font-medium text-neutral-400">
							夜间（深色）
						</div>
						<div className={`mt-1.5 grid gap-2 ${cols}`}>
							{THEMES.filter((t) => t.dark).map((t) =>
								card(t, sysDark === t.id, setSystemDarkTheme),
							)}
						</div>
					</div>
					<p className="px-0.5 text-[11px] text-neutral-500">
						按系统明暗在以上两套主题间自动切换；黄点表示当前正在使用
					</p>
				</div>
			)}
			{tab === "wallpaper" && (
				<div className="mt-3">
					<WallpaperPicker />
				</div>
			)}
		</div>
	);
}
