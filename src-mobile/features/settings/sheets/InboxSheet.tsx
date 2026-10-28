import { Inbox } from "lucide-react";
import { nav, paths } from "../../../core/nav";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

export function InboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="收件箱">
			<ListGroup note="收件箱汇总所有会话里等你处理的事：审批、提问、完成的回答和出错的会话。整理规则在电脑上设置。">
				<ListRow
					icon={<Inbox size={22} strokeWidth={1.75} />}
					title="打开收件箱"
					chevron
					onClick={() => {
						onClose();
						nav.push(paths.inbox());
					}}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
