import { ChevronDown, Menu, MoreHorizontal, SquarePen } from "lucide-react";
import { IconButton, TopBar } from "../../../ui";
import { shortModel, thinkLabel } from "../lib/models";

/** Shared home/chat chrome; the picker exposes the complete model name. */
export function ChatHeader({ model, thinking, onMenu, onModel, onNew, onTools }: {
	model?: string | null;
	thinking?: string | null;
	onMenu: () => void;
	onModel: () => void;
	onNew: () => void;
	onTools?: () => void;
}) {
	return (
		<TopBar
			left={<IconButton variant="filled" icon={<Menu size={22} />} label="菜单" onClick={onMenu} />}
			center={
				<button type="button" aria-label="选择模型和思考等级" onClick={onModel} className="flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-m-pill px-2 text-m-md text-m-text active:bg-m-surface-hover">
					<span className="min-w-0 truncate">{shortModel(model ?? "") || "默认模型"}</span>
					<span className="shrink-0 whitespace-nowrap text-m-xs text-m-text-3">{thinkLabel(thinking)}</span>
					<ChevronDown size={15} className="shrink-0 text-m-text-3" aria-hidden />
				</button>
			}
			right={<>
				<IconButton variant="filled" icon={<SquarePen size={20} />} label="新建对话" onClick={onNew} />
				{onTools && <IconButton variant="filled" icon={<MoreHorizontal size={22} />} label="工具菜单" onClick={onTools} />}
			</>}
		/>
	);
}
