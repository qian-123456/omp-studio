/** Settings ▸ 回退链与切换 (`model-fallback`): header around FallbackChainsSection. */
import { FallbackChainsSection } from "../FallbackChainsSection";
import { useSettingsNav } from "../settingsNav";
import { SectionHeader } from "../ui";

export function FallbackSection() {
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="fallbackChainsPanel">
			<SectionHeader
				title="回退链与切换"
				description="角色失败后依次尝试的备选模型，以及会话内切换顺序与终端 /model 的保存位置；主力模型请在「模型角色」中设置"
			/>
			<FallbackChainsSection query={query} />
		</div>
	);
}
