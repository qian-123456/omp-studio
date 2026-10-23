/** Settings ▸ 插件 (`plugins`). */
import { PluginsSection } from "../PluginsSection";
import { useSettingsNav } from "../settingsNav";
import { useSettingsProjectCwd } from "../useAppSettings";

export function PluginsSettingsSection() {
	const { query } = useSettingsNav();
	const cwd = useSettingsProjectCwd();
	return <PluginsSection cwd={cwd} query={query} />;
}
