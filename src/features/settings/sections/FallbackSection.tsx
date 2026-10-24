/** Settings ▸ 备用模型与重试 (`model-fallback`): fallback chains plus the retry / timeout / loop-guard settings. */
import { FallbackChainsSection } from "../FallbackChainsSection";
import { OmpSections } from "../OmpSettingsList";
import { SectionJumpBar } from "../SectionJumpBar";
import { useSettingsNav } from "../settingsNav";
import { SectionHeader } from "../ui";
import { useT } from "../../../stores/language";

export function FallbackSection() {
	const { t } = useT();
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="fallbackChainsPanel">
			<SectionHeader
				title={t("settingsSections.fallback.title")}
				description={t("settingsSections.fallback.description")}
			/>
			<SectionJumpBar />
			<FallbackChainsSection query={query} />
			<OmpSections page="model-fallback" />
		</div>
	);
}
