/** Settings ▸ 手机访问 (`mobile`): header around MobilePanel. */
import { MobilePanel } from "../../mobile/MobilePanel";
import { SectionHeader } from "../ui";

export function MobileSettingsSection() {
	return (
		<div className="space-y-6">
			<SectionHeader
				title="手机访问"
				description="用手机查看和回复会话：启动服务，生成二维码，手机扫码"
			/>
			<MobilePanel />
		</div>
	);
}
