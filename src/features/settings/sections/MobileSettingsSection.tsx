/** Settings ▸ 手机访问 (`mobile`): header around MobilePanel. */
import { MobilePanel } from "../../mobile/MobilePanel";
import { SectionHeader } from "../ui";
import { useT } from "../../../stores/language";

export function MobileSettingsSection() {
	const { t } = useT();
	return (
		<div className="space-y-6">
			<SectionHeader
				title={t("settingsSections.mobile.title")}
				description={t("settingsSections.mobile.description")}
			/>
			<MobilePanel />
		</div>
	);
}
