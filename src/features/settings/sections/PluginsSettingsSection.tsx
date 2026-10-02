/** Settings ▸ 插件 (`plugins`). */
import { ompSectionId } from "../navigation";
import { PluginsSection } from "../PluginsSection";
import { useSettingsNav } from "../settingsNav";
import { useSettingsProjectCwd } from "../useAppSettings";

export function PluginsSettingsSection() {
	const { query, navigate } = useSettingsNav();
	const cwd = useSettingsProjectCwd();
	return <PluginsSection cwd={cwd} query={query} onNavigateSection={(id) => navigate(ompSectionId(id))} />;
}
