/** [B] Argument-completion provider table: `"<command> <sub>"` → provider.
 * The composer has one generic path ("chip.name + chip.sub has a provider →
 * show its popup"); add an entry here to teach another subcommand to complete
 * its first argument from a real local data source. */

import { Puzzle, Server } from "lucide-react";
import type { PluginItem } from "../../../lib/contracts";
import { mcpConfigList, pluginsList } from "../../../lib/ipc";
import { tNow } from "../../../stores/language";
import type { ArgCandidate, ArgProvider } from "./argComplete";
import { MCP_SERVER_ARG_SUBS, toMcpCandidate } from "./mcpServers";

export function describePlugin(p: PluginItem): string {
	const state = p.enabled ? tNow("slash.enabled") : tNow("slash.disabled");
	const parts = [state, p.kind];
	if (p.version) parts.push(`v${p.version}`);
	const head = parts.join(" · ");
	const tail = [p.description, p.scope ? tNow("slash.sourceScope", { scope: p.scope }) : ""].filter(Boolean);
	return [head, ...tail].join(" · ");
}

const mcpProvider: ArgProvider = {
	groupKey: "mcp",
	icon: Server,
	load: async (cwd) => (await mcpConfigList(cwd)).servers.map(toMcpCandidate),
};

const pluginProvider: ArgProvider = {
	groupKey: "plugin",
	icon: Puzzle,
	load: async (cwd): Promise<ArgCandidate[]> =>
		(await pluginsList(cwd)).plugins.map((p) => ({
			name: p.name,
			description: describePlugin(p),
			enabled: p.enabled,
		})),
};

const PROVIDERS = new Map<string, ArgProvider>();
function register(command: string, subs: readonly string[], provider: ArgProvider): void {
	for (const sub of subs) PROVIDERS.set(`${command} ${sub}`, provider);
}

register("mcp", MCP_SERVER_ARG_SUBS.mcp ?? [], mcpProvider);
register("plugins", ["enable", "disable"], pluginProvider);

/** Provider for `/<command> <sub>`'s first argument, if one exists. */
export function findArgProvider(command: string, sub: string | undefined): ArgProvider | null {
	return sub ? (PROVIDERS.get(`${command} ${sub}`) ?? null) : null;
}
