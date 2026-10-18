import { useEffect, useRef } from "react";
import { Settings as SettingsIcon, X } from "lucide-react";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { hideAllScrollPills } from "../../lib/scrollPills";
import { useUi } from "../../stores/ui";
import { SettingsPage } from "./SettingsPage";

/**
 * Settings floating modal overlay.
 * Renders centered over the workbench, preserving the underlying view.
 */
export function SettingsOverlay() {
	const isSettingsOpen = useUi((s) => s.centerView === "settings");
	if (!isSettingsOpen) return null;
	return <SettingsOverlayInner />;
}

function SettingsOverlayInner() {
	const closeSettings = useUi((s) => s.closeSettings);
	const dialogRef = useRef<HTMLDivElement>(null);

	useEscapeKey(closeSettings);

	// Focus management: focus dialog or first control on mount, restore on unmount
	useEffect(() => {
		const previous = document.activeElement;
		const target =
			dialogRef.current?.querySelector<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
			) ?? dialogRef.current;
		target?.focus();
		return () => {
			hideAllScrollPills();
			if (previous instanceof HTMLElement && previous.isConnected) {
				previous.focus();
			}
		};
	}, []);

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4 sm:p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) closeSettings();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="settings-dialog-title"
				tabIndex={-1}
				className="flex h-[80vh] max-h-[820px] w-[920px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-[var(--bg-panel)] text-neutral-200 shadow-apple-modal hairline outline-none"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (isComposing(e)) return;

					// Escape key closes settings
					if (e.key === "Escape") {
						e.stopPropagation();
						closeSettings();
						return;
					}

					// Focus trap across accessible controls inside dialog
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>(
								'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
							),
						).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

						if (controls.length > 0) {
							const first = controls[0];
							const last = controls[controls.length - 1];
							if (
								e.shiftKey &&
								(document.activeElement === first ||
									!controls.includes(document.activeElement as HTMLElement))
							) {
								e.preventDefault();
								last?.focus();
							} else if (
								!e.shiftKey &&
								(document.activeElement === last ||
									!controls.includes(document.activeElement as HTMLElement))
							) {
								e.preventDefault();
								first?.focus();
							}
						}
					}

					// Suppress global app hotkeys (Cmd+Shift+K, Cmd+B, Cmd+J, Cmd+N, etc.) while inside settings
					if (e.metaKey || e.ctrlKey) {
						e.stopPropagation();
					}
				}}
			>
				{/* Top bar */}
				<div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-divider)] px-4">
					<div className="flex items-center gap-2 text-xs font-semibold text-neutral-200 tracking-[-0.01em]">
						<SettingsIcon className="h-4 w-4 text-amber-400" />
						<span id="settings-dialog-title">系统设置</span>
					</div>
					<button
						type="button"
						onClick={closeSettings}
						className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
						title="关闭设置 (Esc)"
						aria-label="关闭设置"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{/* Body */}
				<div className="min-h-0 flex-1 overflow-hidden">
					<SettingsPage onClose={closeSettings} />
				</div>
			</div>
		</div>
	);
}
