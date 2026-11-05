export function suppressWebViewContextMenu(e: MouseEvent): void {
	if (e.defaultPrevented) return;
	// If the page failed to mount React (#root has no elements or fallback is active), allow the native context menu (Reload / Inspect)
	const root = document.getElementById("root");
	if (!root || !root.firstElementChild || root.firstElementChild.id === "startup-fallback") return;
	const target = e.target;
	if (target instanceof Element && target.closest("a[href], img")) return;
	if (
		target instanceof HTMLElement &&
		(target.isContentEditable || target.closest("input, textarea"))
	)
		return;
	e.preventDefault();
}
