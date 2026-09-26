/**
 * Top bar quick theme switcher. Full appearance controls (theme gallery,
 * font size, UI density) live in settings → 外观; this popover only picks
 * the theme itself so switching never leaves the current view.
 */
import { Monitor, Palette, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	THEMES,
	setTheme,
	useThemeChoice,
	type ThemeChoice,
} from "../lib/theme";
import { useUi } from "../stores/ui";

export function ThemeMenu() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const choice = useThemeChoice();
	const openSettings = useUi((s) => s.openSettings);

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("mousedown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const pick = (id: ThemeChoice) => {
		setTheme(id);
	};

	const optionBtn = (id: ThemeChoice, label: string) => (
		<button
			key={id}
			type="button"
			onClick={() => pick(id)}
			className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
				choice === id
					? "bg-neutral-800 text-neutral-100"
					: "text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100"
			}`}
		>
			<span className="flex-1">{label}</span>
			{choice === id && (
				<span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
			)}
		</button>
	);

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-200"
				title="主题外观"
			>
				<Palette size={16} />
			</button>

			{open && (
				<div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl">
					<div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-neutral-500">
						主题
					</div>
					<div className="grid max-h-72 grid-cols-3 gap-1 overflow-y-auto">
						{THEMES.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => pick(t.id)}
								title={t.name}
								className={`rounded-md border p-1.5 text-left transition-colors ${
									choice === t.id
										? "border-amber-500"
										: "border-transparent hover:border-neutral-600"
								}`}
							>
								<span
									className="block h-7 w-full rounded overflow-hidden border border-black/20"
									style={{ backgroundColor: t.swatch.bg }}
									aria-hidden
								>
									<span
										className="mt-0.5 ml-0.5 block h-2 w-6 rounded-sm"
										style={{ backgroundColor: t.swatch.panel }}
									>
										<span
											className="mt-0.5 ml-0.5 block h-1 w-3 rounded-full"
											style={{ backgroundColor: t.swatch.accent }}
										/>
									</span>
								</span>
								<span className="mt-1 block truncate text-[10px] text-neutral-300">
									{t.name}
								</span>
							</button>
						))}
					</div>

					<div className="mt-2 border-t border-neutral-800 pt-2">
						{optionBtn("system", "跟随系统")}
					</div>

					<button
						type="button"
						onClick={() => {
							setOpen(false);
							openSettings("appearance");
						}}
						className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
					>
						<Settings2 size={13} />
						<span className="flex-1">更多外观设置…</span>
					</button>
					<div className="mt-1 flex items-center gap-1.5 px-2 pb-1 text-[10px] text-neutral-600">
						<Monitor size={10} />
						<span>跟随系统按系统明暗自动切换主题</span>
					</div>
				</div>
			)}
		</div>
	);
}
