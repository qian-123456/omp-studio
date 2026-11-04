import { Menu, MoreHorizontal, SquarePen } from "lucide-react";
import { IconButton, TopBar } from "../../../ui";
import { shortModel, thinkLabel } from "../lib/models";

/**
 * Shared home/chat top chrome:
 * - Left & right: liquid glass style buttons
 * - Center: Session Name (primary) + File Path (secondary, smaller/dimmer below)
 */
export function ChatHeader({
	title,
	subtitle,
	onTitleClick,
	ariaLabel,
	onMenu,
	onNew,
	onTools,
	model,
	thinking,
	onModel,
}: {
	title?: string;
	subtitle?: string | null;
	onTitleClick?: () => void;
	ariaLabel?: string;
	onMenu: () => void;
	onNew: () => void;
	onTools?: () => void;
	model?: string | null;
	thinking?: string | null;
	onModel?: () => void;
}) {
	const displayTitle = title ?? (model ? shortModel(model) : "新对话");
	const displaySubtitle = subtitle ?? (title ? null : thinkLabel(thinking));

	return (
		<TopBar
			left={<IconButton variant="glass" icon={<Menu size={22} />} label="菜单" onClick={onMenu} />}
			center={
				<button
					type="button"
					aria-label={ariaLabel ?? (displaySubtitle ? `${displayTitle}，${displaySubtitle}` : displayTitle)}
					onClick={onTitleClick ?? onModel}
					disabled={!onTitleClick && !onModel}
					className="flex min-w-0 max-w-full flex-col items-center justify-center px-2 py-0.5 text-center active:opacity-75 disabled:cursor-default"
				>
					<span className="min-w-0 max-w-full truncate text-m-sm font-semibold whitespace-nowrap text-m-text">
						{displayTitle}
					</span>
					{displaySubtitle ? (
						<span className="min-w-0 max-w-full truncate text-[11px] leading-tight whitespace-nowrap text-m-text-3">
							{displaySubtitle}
						</span>
					) : null}
				</button>
			}
			right={
				<>
					<IconButton variant="glass" icon={<SquarePen size={20} />} label="新建对话" onClick={onNew} />
					{onTools && <IconButton variant="glass" icon={<MoreHorizontal size={22} />} label="工具菜单" onClick={onTools} />}
				</>
			}
		/>
	);
}
