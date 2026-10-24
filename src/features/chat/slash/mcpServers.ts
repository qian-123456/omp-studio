/** [B] Argument completion for `/mcp <sub> <name>`: pure helpers that turn the
 * configured MCP servers into popup rows. */

import { Server } from "lucide-react";
import type { McpServerItem } from "../../../lib/contracts";
import { applyArgName, buildArgItems, type ArgCandidate } from "./argComplete";
import type { SlashMenuItem } from "./menu";
import type { SlashGroup } from "./types";
import { tNow } from "../../../stores/language";
/** Which subcommands of which legacy command take an MCP server name as their
 * first argument, keyed `command -> sub[]`. Grow here for other commands. */
export const MCP_SERVER_ARG_SUBS: Record<string, readonly string[]> = {
	mcp: ["enable", "disable", "remove", "test", "reauth", "unauth", "reconnect"],
};

export function takesMcpServerArg(command: string, sub: string | undefined): boolean {
	return !!sub && (MCP_SERVER_ARG_SUBS[command]?.includes(sub) ?? false);
}

const MCP_PROVIDER_VIEW: { readonly groupKey: SlashGroup; readonly icon: typeof Server } = {
	groupKey: "mcp",
	icon: Server,
};

/** Server → completion candidate. */
export function toMcpCandidate(s: McpServerItem): ArgCandidate {
	return { name: s.name, description: describeMcpServer(s), enabled: s.enabled };
}

/** One-line transport / endpoint summary: `http · https://…` or `stdio · cmd args`. */
function endpointSummary(s: McpServerItem): string {
	const target =
		s.transport === "stdio" ? [s.command, ...s.args].filter(Boolean).join(" ") : (s.url ?? "");
	return target ? `${s.transport} · ${target}` : s.transport;
}

/** Description line: state + transport, endpoint and source scope. */
export function describeMcpServer(s: McpServerItem): string {
	const state = s.enabled ? tNow("slash.enabled") : tNow("slash.disabled");
	const parts = [`${state} · ${endpointSummary(s)}`];
	if (s.scope) parts.push(tNow("slash.sourceScope", { scope: s.scope }));
	return parts.join(" · ");
}

/** Menu rows for `servers` (see `buildArgItems` for ordering rules). */
export function buildMcpServerItems(
	servers: readonly McpServerItem[],
	sub: string,
	query: string,
): SlashMenuItem[] {
	return buildArgItems(MCP_PROVIDER_VIEW, servers.map(toMcpCandidate), sub, query);
}

export const applyMcpServerName = applyArgName;
