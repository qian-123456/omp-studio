/**
 * Visual-viewport tracking for the on-screen keyboard.
 *
 * iOS pans the layout viewport when the keyboard opens. We pin the app to the visual viewport by
 * writing CSS variables (`--m-vh`, `--m-kb`) and a body translate — ONLY from visualViewport
 * resize/scroll events, rAF-throttled and skipped when nothing changed. Typing never reaches this
 * code, so keystrokes cause no style recalculation or layout reads.
 */
export function installViewportTracking(): () => void {
	const vv = window.visualViewport;
	if (!vv) return () => {};
	const root = document.documentElement;
	let raf = 0;
	let lastH = -1;
	let lastKb = -1;
	let lastTop = -1;

	const apply = () => {
		raf = 0;
		const h = Math.round(vv.height);
		const top = Math.round(vv.offsetTop);
		const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
		if (h !== lastH) {
			root.style.setProperty("--m-vh", `${h}px`);
			lastH = h;
		}
		if (kb !== lastKb) {
			root.style.setProperty("--m-kb", `${kb}px`);
			lastKb = kb;
		}
		if (top !== lastTop) {
			document.body.style.transform = top > 0 ? `translateY(${top}px)` : "";
			lastTop = top;
		}
	};
	const schedule = () => {
		if (!raf) raf = requestAnimationFrame(apply);
	};
	vv.addEventListener("resize", schedule);
	vv.addEventListener("scroll", schedule);
	apply();
	return () => {
		vv.removeEventListener("resize", schedule);
		vv.removeEventListener("scroll", schedule);
		if (raf) cancelAnimationFrame(raf);
	};
}
