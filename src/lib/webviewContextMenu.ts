export function suppressWebViewContextMenu(e: MouseEvent): void {
	if (e.defaultPrevented) return;
	const target = e.target;
	if (target instanceof Element && target.closest("a[href], img")) return;
	if (
		target instanceof HTMLElement &&
		(target.isContentEditable || target.closest("input, textarea"))
	)
		return;
	e.preventDefault();
}
