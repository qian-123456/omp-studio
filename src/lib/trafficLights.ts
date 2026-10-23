import { useEffect, useState } from "react";

const isMac =
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS/i.test(navigator.userAgent);

/** True while the overlay macOS traffic lights occupy the title bar (windowed mode); they hide in fullscreen. */
export function useTrafficLightsVisible(): boolean {
	const [fullscreen, setFullscreen] = useState(false);
	useEffect(() => {
		if (!isMac) return;
		let off: (() => void) | undefined;
		let alive = true;
		void import("@tauri-apps/api/window")
			.then(async ({ getCurrentWindow }) => {
				const win = getCurrentWindow();
				const sync = async () => {
					const fs = await win.isFullscreen();
					if (alive) setFullscreen(fs);
				};
				await sync();
				const un = await win.onResized(() => void sync());
				if (alive) off = un;
				else un();
			})
			.catch(() => {
				/* not running inside Tauri (tests / browser): treated as windowed */
			});
		return () => {
			alive = false;
			off?.();
		};
	}, []);
	return isMac && !fullscreen;
}
