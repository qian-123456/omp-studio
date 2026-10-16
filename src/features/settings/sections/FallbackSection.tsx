/** Settings ▸ 回退链与切换 (`model-fallback`): header around FallbackChainsSection. */
import { FallbackChainsSection } from "../FallbackChainsSection";
import { useSettingsNav } from "../settingsNav";
import { SectionHeader } from "../ui";

export function FallbackSection() {
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="fallbackChainsPanel">
			<SectionHeader
				title="备用模型"
				description="某个角色的模型调用失败后，按这里设定的顺序换下一个模型兜底；主力模型在「模型角色」中设置"
			/>
			<FallbackChainsSection query={query} />
		</div>
	);
}
