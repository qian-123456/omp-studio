/** Settings ▸ MCP 服务器 (`mcp`). */
import { McpSection } from "../McpSection";
import { ompSectionId } from "../navigation";
import { useSettingsNav } from "../settingsNav";
import { useSettingsProjectCwd } from "../useAppSettings";

export function McpSettingsSection() {
	const { query, navigate } = useSettingsNav();
	const cwd = useSettingsProjectCwd();
	return <McpSection cwd={cwd} query={query} onNavigateSection={(id) => navigate(ompSectionId(id))} />;
}
