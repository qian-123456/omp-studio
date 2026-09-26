/**
 * Two-level theme picker ("mini router").
 *
 * The root view only offers 深色 / 浅色 / 跟随系统; opening one reveals the
 * relevant list — a dark-theme grid, a light-theme grid, or the day/night
 * pair used while following the system. Shared by the top-bar popover
 * (compact) and the appearance settings section (full size).
 */
import { ArrowLeft, Monitor, Moon, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
	THEMES,
	setSystemDarkTheme,
	setSystemLightTheme,
	setTheme,
	themeById,
	useSystemDarkTheme,
	useSystemLightTheme,
	useThemeChoice,
	type ThemeChoice,
	type ThemeDef,
} from "../lib/theme";

type PickerView = "root" | "dark" | "light" | "system";

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
			className={`rounded-lg border p-2 text-left transition-colors ${
				active
					? "border-amber-500"
					: "border-neutral-700/60 hover:border-neutral-600"
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
	const [view, setView] = useState<PickerView>("root");
	const choice = useThemeChoice();
	const sysDark = useSystemDarkTheme();
	const sysLight = useSystemLightTheme();

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

	if (view !== "root") {
		const title =
			view === "dark" ? "深色主题" : view === "light" ? "浅色主题" : "跟随系统";
		return (
			<div>
				<button
					type="button"
					onClick={() => setView("root")}
					className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-200"
				>
					<ArrowLeft size={12} />
					<span>返回</span>
				</button>
				<span className="ml-1 text-xs font-medium text-neutral-200">{title}</span>

				{view === "dark" && (
					<div className={`mt-2 grid gap-2 ${cols}`}>
						{THEMES.filter((t) => t.dark).map((t) =>
							card(t, choice === t.id, (id) => setTheme(id as ThemeChoice)),
						)}
					</div>
				)}
				{view === "light" && (
					<div className={`mt-2 grid gap-2 ${cols}`}>
						{THEMES.filter((t) => !t.dark).map((t) =>
							card(t, choice === t.id, (id) => setTheme(id as ThemeChoice)),
						)}
					</div>
				)}
				{view === "system" && (
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
						<p className="px-0.5 text-[10px] text-neutral-600">
							按系统明暗在以上两套主题间自动切换
						</p>
					</div>
				)}
			</div>
		);
	}

	// Root view: three entries, each with a short summary of its current state.
	const chosen = choice === "system" ? undefined : themeById(choice);

	const row = (
		icon: ReactNode,
		label: string,
		sub: string,
		target: PickerView,
		active: boolean,
		onNavigate?: () => void,
	) => (
		<button
			key={target}
			type="button"
			onClick={() => {
				onNavigate?.();
				setView(target);
			}}
			className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
				active
					? "border-amber-500/70"
					: "border-transparent hover:border-neutral-600 hover:bg-neutral-800/40"
			}`}
		>
			<span className="text-neutral-400">{icon}</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-medium text-neutral-200">{label}</span>
				<span className="block truncate text-[10px] text-neutral-500">{sub}</span>
			</span>
			{active && (
				<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
			)}
		</button>
	);

	return (
		<div className="space-y-1">
			{row(
				<Moon size={14} />,
				"深色",
				chosen?.dark ? chosen.name : `夜间 · ${themeById(sysDark)?.name ?? "—"}`,
				"dark",
				chosen?.dark === true,
			)}
			{row(
				<Sun size={14} />,
				"浅色",
				chosen && !chosen.dark
					? chosen.name
					: `白天 · ${themeById(sysLight)?.name ?? "—"}`,
				"light",
				chosen != null && !chosen.dark,
			)}
			{row(
				<Monitor size={14} />,
				"跟随系统",
				`白天 ${themeById(sysLight)?.name ?? "—"} · 夜间 ${themeById(sysDark)?.name ?? "—"}`,
				"system",
				choice === "system",
				// Entering the system view also activates follow-system mode.
				() => setTheme("system"),
			)}
		</div>
	);
}
