/** Settings ▸ MCP 服务器 (`mcp`). */
import { McpSection } from "../McpSection";
import { useSettingsNav } from "../settingsNav";
import { useSettingsProjectCwd } from "../useAppSettings";

export function McpSettingsSection() {
	const { query } = useSettingsNav();
	const cwd = useSettingsProjectCwd();
	return <McpSection cwd={cwd} query={query} />;
}
