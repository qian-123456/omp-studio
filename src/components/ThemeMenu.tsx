/**
 * Top bar quick theme switcher — a thin popover around the shared two-level
 * ThemePicker (深色 / 浅色 / 跟随系统 → theme lists). Full-size instance
 * lives in settings → 外观.
 */
import { Palette } from "lucide-react";
import { useRef, useState } from "react";
import { ThemePicker } from "./ThemePicker";
import { FloatingLayer } from "./FloatingLayer";
import { useUi } from "../stores/ui";
import { useT } from "../stores/language";

export function ThemeMenu() {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const openSettings = useUi((s) => s.openSettings);

	return (
		<div className="relative">
			<button
				ref={btnRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800/60 hover:text-neutral-200"
				title={t("theme.themeAppearance")}
			>
				<Palette size={16} />
			</button>

			<FloatingLayer
				anchor={open ? btnRef.current : null}
				placement="bottom-end"
				offset={4}
				layer="popover"
				ignoreRefs={[btnRef]}
				onDismiss={() => setOpen(false)}
				className="w-64 p-2 text-xs"
			>
				<div className="max-h-[70vh] overflow-y-auto">
					<ThemePicker compact />
				</div>
				<button
					type="button"
					onClick={() => {
						setOpen(false);
						openSettings("appearance");
					}}
					className="mt-2 flex w-full items-center gap-2 rounded-md border-t border-[var(--border-divider)] px-2 pt-2 text-left text-[11px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
				>
					<span className="flex-1">{t("theme.moreAppearanceSettings")}</span>
				</button>
			</FloatingLayer>
		</div>
	);
}
