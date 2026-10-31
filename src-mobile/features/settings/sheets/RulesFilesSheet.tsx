import { FileText } from "lucide-react";
import { ListGroup, ListRow } from "../../../ui";
import { SettingsSheet } from "../rows";

/** Desktop-managed until the mobile API exposes the real configuration. */
export function RulesFilesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<SettingsSheet open={open} onClose={onClose} title="规则文件" subtitle="全局和项目规则文件由电脑端管理。">
			<ListGroup>
				<ListRow
					icon={<FileText size={22} strokeWidth={1.75} />}
					title="由电脑管理"
					subtitle="手机端尚无规则配置读取接口，无法确认当前生效的文件和内容。请在电脑端的规则文件设置中查看和编辑。"
					chevron={false}
				/>
			</ListGroup>
		</SettingsSheet>
	);
}
