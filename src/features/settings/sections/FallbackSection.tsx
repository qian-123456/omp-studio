/** Settings ▸ 备用模型与重试 (`model-fallback`): fallback chains plus the retry / timeout / loop-guard settings. */
import { FallbackChainsSection } from "../FallbackChainsSection";
import { OmpSections } from "../OmpSettingsList";
import { useSettingsNav } from "../settingsNav";
import { SectionHeader } from "../ui";

export function FallbackSection() {
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="fallbackChainsPanel">
			<SectionHeader
				title="备用模型与重试"
				description="模型出错或额度用完时：自动换备用模型、重试、超时与防死循环"
			/>
			<FallbackChainsSection query={query} />
			<OmpSections page="model-fallback" />
		</div>
	);
}
