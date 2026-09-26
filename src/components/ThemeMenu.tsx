/**
 * Top bar quick theme switcher — a thin popover around the shared two-level
 * ThemePicker (深色 / 浅色 / 跟随系统 → theme lists). Full-size instance
 * lives in settings → 外观.
 */
import { Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ThemePicker } from "./ThemePicker";
import { useUi } from "../stores/ui";

export function ThemeMenu() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
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
				<div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-xs shadow-xl">
					<div className="max-h-[70vh] overflow-y-auto">
						<ThemePicker compact />
					</div>
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							openSettings("appearance");
						}}
						className="mt-2 flex w-full items-center gap-2 rounded-md border-t border-neutral-800 px-2 pt-2 text-left text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-100"
					>
						<span className="flex-1">更多外观设置…</span>
					</button>
				</div>
			)}
		</div>
	);
}
