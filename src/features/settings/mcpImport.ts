/** Pure parser for pasted MCP configs (Claude/Cursor, VS Code, bare maps, single entries). */
import { tNow } from "../../stores/language";
import { NAME_RE, transportLabel } from "./mcpDraft";

export type ImportEntry = Record<string, unknown>;

export type ImportParse =
	| { kind: "servers"; servers: { name: string; entry: ImportEntry }[] }
	/** One bare `{command|url …}` entry; the caller asks for a name. */
	| { kind: "single"; entry: ImportEntry }
	| { kind: "error"; message: string };

/** Remove `//` and `/* *\/` comments and trailing commas outside of strings. */
export function stripJsonExtras(text: string): string {
	const out: string[] = [];
	let inStr = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (inStr) {
			out.push(c);
			if (c === "\\" && i + 1 < text.length) out.push(text[++i]!);
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') {
			inStr = true;
			out.push(c);
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out.push("\n");
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 1;
			out.push(" ");
		} else if (c === "}" || c === "]") {
			let j = out.length - 1;
			while (j >= 0 && /\s/.test(out[j]!)) j--;
			if (j >= 0 && out[j] === ",") out.splice(j, 1);
			out.push(c);
		} else {
			out.push(c);
		}
	}
	return out.join("");
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const asEntry = (v: unknown): ImportEntry => {
	const entry: ImportEntry = isObject(v) ? { ...v } : {};
	// Placement is chosen in the dialog; the file's own enabled flag must not leak in.
	delete entry.enabled;
	return entry;
};

const toServers = (map: Record<string, unknown>): ImportParse => {
	const servers = Object.entries(map).map(([name, v]) => ({ name, entry: asEntry(v) }));
	return servers.length > 0
		? { kind: "servers", servers }
		: { kind: "error", message: tNow("mcp.noServersFound") };
};

export function parseMcpImport(text: string): ImportParse {
	if (!text.trim()) return { kind: "error", message: tNow("mcp.noContent") };
	let root: unknown;
	try {
		root = JSON.parse(stripJsonExtras(text));
	} catch (e) {
		return { kind: "error", message: tNow("mcp.invalidJson", { error: e instanceof Error ? e.message : String(e) }) };
	}
	if (!isObject(root)) return { kind: "error", message: tNow("mcp.needJsonObject") };
	if (isObject(root.mcpServers)) return toServers(root.mcpServers);
	if (isObject(root.servers)) return toServers(root.servers);
	if (isObject(root.mcp) && isObject(root.mcp.servers)) return toServers(root.mcp.servers);
	if (typeof root.command === "string" || typeof root.url === "string") {
		return { kind: "single", entry: asEntry(root) };
	}
	const values = Object.values(root);
	if (values.length > 0 && values.every(isObject)) return toServers(root);
	return { kind: "error", message: tNow("mcp.unrecognizedFormat") };
}

/** Transport label + endpoint text for the preview list. */
export function describeEntry(entry: ImportEntry): { transport: string; endpoint: string } {
	const url = typeof entry.url === "string" ? entry.url : null;
	const command = typeof entry.command === "string" ? entry.command : null;
	const type =
		entry.type === "sse" || entry.type === "http" ? entry.type : url && !command ? "http" : "stdio";
	const args = Array.isArray(entry.args) ? entry.args.map(String).join(" ") : "";
	return {
		transport: transportLabel(type),
		endpoint: command ? `${command}${args ? ` ${args}` : ""}` : (url ?? ""),
	};
}

/** Why an entry cannot be imported, or null. */
export function importSkipReason(
	name: string,
	entry: ImportEntry,
	existingNames: readonly string[],
): string | null {
	if (!NAME_RE.test(name)) return tNow("mcp.importSkipBadName");
	if (existingNames.includes(name)) return tNow("mcp.importSkipDuplicate");
	const command = typeof entry.command === "string" && entry.command.trim();
	const url = typeof entry.url === "string" && entry.url.trim();
	if (!command && !url) return tNow("mcp.importSkipMissingEndpoint");
	return null;
}
