import clsx from "clsx";
import type { ReactNode } from "react";
import { FloatingLayer, type Anchor } from "../../components/FloatingLayer";

export type MenuEntry =
	| "separator"
	| {
			key: string;
			label: string;
			icon?: ReactNode;
			title?: string;
			danger?: boolean;
			disabled?: boolean;
			onSelect: () => void;
	  };

/** Shared popup menu for the worktree ⋯ button and row right-click. */
export function WorktreeActionMenu({
	anchor,
	header,
	entries,
	onDismiss,
}: {
	anchor: Anchor;
	header?: ReactNode;
	entries: MenuEntry[];
	onDismiss: () => void;
}) {
	// Drop leading/trailing/duplicate separators left behind by hidden items.
	const items = entries.filter(
		(e, i, all) =>
			e !== "separator" ||
			(i > 0 && i < all.length - 1 && all[i - 1] !== "separator" && all.slice(i + 1).some((n) => n !== "separator")),
	);
	return (
		<FloatingLayer
			anchor={anchor}
			placement="bottom-end"
			layer="menu"
			onDismiss={onDismiss}
			className="min-w-52 max-w-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
		>
			{header && (
				<div className="truncate border-b border-neutral-800 px-2 py-1 text-[10px] font-semibold text-neutral-400">
					{header}
				</div>
			)}
			<div role="menu" className="py-0.5">
				{items.map((e, i) =>
					e === "separator" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
						<div key={`sep-${i}`} className="my-1 border-t border-neutral-800" />
					) : (
						<button
							key={e.key}
							type="button"
							role="menuitem"
							disabled={e.disabled}
							title={e.title}
							onClick={() => {
								onDismiss();
								e.onSelect();
							}}
							className={clsx(
								"flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
								e.danger
									? "text-rose-300 hover:bg-rose-950/40"
									: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
						>
							<span className="flex w-3.5 shrink-0 justify-center">{e.icon}</span>
							<span className="truncate">{e.label}</span>
						</button>
					),
				)}
			</div>
		</FloatingLayer>
	);
}
