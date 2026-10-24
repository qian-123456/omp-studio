/** Pure helpers for the MCP server add/edit form (McpServerEditor) and the import dialog. */
import { tNow } from "../../stores/language";
import type { McpServerItem, McpServerPatch } from "../../lib/contracts";

export type McpTransport = "stdio" | "http" | "sse";

export interface KvRow {
	key: string;
	value: string;
}

export interface ServerDraft {
	/** Existing entry when editing; null when adding. */
	original: McpServerItem | null;
	name: string;
	type: McpTransport;
	command: string;
	/** One arg per line. */
	args: string;
	url: string;
	cwd: string;
	timeout: string;
	instructions: boolean;
	/** New env/header entries written verbatim; untouched keys are preserved. */
	envAdds: KvRow[];
	headerAdds: KvRow[];
	/** Keys to delete from env/headers. */
	envRemoves: Set<string>;
	headerRemoves: Set<string>;
}

export const TRANSPORT_LABELS: Record<McpTransport, string> = {
	get stdio() {
		return tNow("mcp.transportStdio");
	},
	get http() {
		return tNow("mcp.transportHttp");
	},
	get sse() {
		return tNow("mcp.transportSse");
	},
};

export function transportLabel(t: string): string {
	return t in TRANSPORT_LABELS ? TRANSPORT_LABELS[t as McpTransport] : t;
}

export function draftFrom(original: McpServerItem | null): ServerDraft {
	return {
		original,
		name: original?.name ?? "",
		type:
			original?.transport === "http" || original?.transport === "sse"
				? original.transport
				: "stdio",
		command: original?.command ?? "",
		args: (original?.args ?? []).join("\n"),
		url: original?.url ?? "",
		cwd: original?.cwd ?? "",
		timeout: original?.timeoutMs != null ? String(original.timeoutMs) : "",
		instructions: original?.instructions ?? true,
		envAdds: [],
		headerAdds: [],
		envRemoves: new Set(),
		headerRemoves: new Set(),
	};
}

export const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type DraftErrors = Partial<
	Record<"name" | "command" | "url" | "timeout" | "env" | "headers", string>
>;

/**
 * Validate a draft before saving. `existingNames` are every server name already
 * in the catalog (the original name is allowed when editing).
 */
export function validateDraft(d: ServerDraft, existingNames: readonly string[]): DraftErrors {
	const errors: DraftErrors = {};
	const name = d.name.trim();
	if (!name) errors.name = tNow("mcp.nameRequired");
	else if (!NAME_RE.test(name)) errors.name = tNow("mcp.nameInvalid");
	else if (name !== d.original?.name && existingNames.includes(name))
		errors.name = tNow("mcp.nameDuplicate", { name });

	if (d.type === "stdio") {
		if (!d.command.trim()) errors.command = tNow("mcp.commandRequired");
	} else {
		const url = d.url.trim();
		if (!url) errors.url = tNow("mcp.urlRequired");
		else if (!/^https?:\/\/\S+$/i.test(url)) errors.url = tNow("mcp.urlInvalid");
	}

	const timeout = d.timeout.trim();
	if (timeout && !(/^\d+$/.test(timeout) && Number(timeout) > 0))
		errors.timeout = tNow("mcp.timeoutInvalid");

	const kvError = (rows: KvRow[], re: RegExp, what: string): string | undefined => {
		const seen = new Set<string>();
		for (const { key, value } of rows) {
			const k = key.trim();
			if (!k && !value) continue;
			if (!k) return tNow("mcp.kvMissingKey", { what });
			if (!re.test(k)) return tNow("mcp.kvInvalidKey", { what, key: k });
			if (seen.has(k)) return tNow("mcp.kvDuplicateKey", { what, key: k });
			seen.add(k);
		}
		return undefined;
	};
	if (d.type === "stdio") {
		const e = kvError(d.envAdds, ENV_KEY_RE, tNow("mcp.envWhat"));
		if (e) errors.env = e;
	} else {
		const e = kvError(d.headerAdds, HEADER_KEY_RE, tNow("mcp.headersWhat"));
		if (e) errors.headers = e;
	}
	return errors;
}

export function buildPatch(d: ServerDraft): McpServerPatch {
	const patch: McpServerPatch = {};
	const command = d.command.trim();
	const url = d.url.trim();
	patch.type = d.type;
	if (d.type === "stdio") {
		patch.command = command || null;
		patch.url = null;
		patch.headers = null;
		patch.args = d.args
			.split("\n")
			.map((a) => a.trim())
			.filter(Boolean);
		patch.cwd = d.cwd.trim() || null;
		const env: Record<string, string | null> = {};
		for (const k of d.envRemoves) env[k] = null;
		for (const { key, value } of d.envAdds) {
			const k = key.trim();
			if (k) env[k] = value;
		}
		if (Object.keys(env).length > 0) patch.env = env;
	} else {
		patch.url = url || null;
		patch.command = null;
		patch.args = null;
		patch.env = null;
		patch.cwd = null;
		const headers: Record<string, string | null> = {};
		for (const k of d.headerRemoves) headers[k] = null;
		for (const { key, value } of d.headerAdds) {
			const k = key.trim();
			if (k) headers[k] = value;
		}
		if (Object.keys(headers).length > 0) patch.headers = headers;
	}
	if (d.timeout.trim()) {
		const n = Number(d.timeout.trim());
		patch.timeout = Number.isFinite(n) ? n : d.timeout.trim();
	} else if (d.original?.timeoutMs != null) {
		patch.timeout = null;
	}
	patch.instructions = d.instructions;
	return patch;
}

/** Last path segment of a path, used as a project's display name. */
export function projectName(cwd: string): string {
	const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || cwd;
}

/**
 * Quote-aware shell-style split: whitespace separates tokens, '…' and "…" group,
 * a backslash escapes a quote, space or backslash. An unterminated quote runs to the end.
 */
export function splitCommandLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let has = false;
	let quote: '"' | "'" | null = null;
	for (let i = 0; i < line.length; i++) {
		const c = line[i]!;
		if (c === "\\" && i + 1 < line.length && /["' \\]/.test(line[i + 1]!)) {
			cur += line[++i];
			has = true;
		} else if (quote) {
			if (c === quote) quote = null;
			else cur += c;
		} else if (c === '"' || c === "'") {
			quote = c;
			has = true;
		} else if (/\s/.test(c)) {
			if (has) out.push(cur);
			cur = "";
			has = false;
		} else {
			cur += c;
			has = true;
		}
	}
	if (has) out.push(cur);
	return out;
}

/**
 * When a whole command line sits in 命令 while 参数 is empty, move everything after the
 * first token into 参数. Returns null when nothing should change.
 */
export function splitDraftCommand(d: ServerDraft): ServerDraft | null {
	if (d.type !== "stdio" || d.args.trim() !== "" || !/\s/.test(d.command.trim())) return null;
	const tokens = splitCommandLine(d.command.trim());
	if (tokens.length < 2) return null;
	return { ...d, command: tokens[0]!, args: tokens.slice(1).join("\n") };
}
