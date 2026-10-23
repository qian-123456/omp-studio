/** Pure helpers for the MCP server add/edit form (McpSection). */
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
	path: string;
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
	stdio: "本地命令",
	http: "HTTP",
	sse: "SSE",
};

export function transportLabel(t: string): string {
	return t in TRANSPORT_LABELS ? TRANSPORT_LABELS[t as McpTransport] : t;
}

export function draftFrom(original: McpServerItem | null, defaultPath: string): ServerDraft {
	return {
		original,
		name: original?.name ?? "",
		path: original?.sourceFile ?? defaultPath,
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

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type DraftErrors = Partial<
	Record<"name" | "command" | "url" | "timeout" | "env" | "headers", string>
>;

/**
 * Validate a draft before saving. `existingNames` are server names already
 * defined in the draft's target file (the original name is allowed when editing).
 */
export function validateDraft(d: ServerDraft, existingNames: readonly string[]): DraftErrors {
	const errors: DraftErrors = {};
	const name = d.name.trim();
	if (!name) errors.name = "请填写名称";
	else if (!NAME_RE.test(name)) errors.name = "名称只能包含字母、数字、- _ .";
	else if (name !== d.original?.name && existingNames.includes(name))
		errors.name = `已存在同名服务器「${name}」`;

	if (d.type === "stdio") {
		if (!d.command.trim()) errors.command = "请填写要运行的命令，例如 npx";
	} else {
		const url = d.url.trim();
		if (!url) errors.url = "请填写服务器地址";
		else if (!/^https?:\/\/\S+$/i.test(url)) errors.url = "地址需以 http:// 或 https:// 开头";
	}

	const timeout = d.timeout.trim();
	if (timeout && !(/^\d+$/.test(timeout) && Number(timeout) > 0))
		errors.timeout = "超时需为正整数（毫秒）";

	const kvError = (rows: KvRow[], re: RegExp, what: string): string | undefined => {
		const seen = new Set<string>();
		for (const { key, value } of rows) {
			const k = key.trim();
			if (!k && !value) continue;
			if (!k) return `${what}缺少名称`;
			if (!re.test(k)) return `${what}名称「${k}」不合法`;
			if (seen.has(k)) return `${what}「${k}」重复`;
			seen.add(k);
		}
		return undefined;
	};
	if (d.type === "stdio") {
		const e = kvError(d.envAdds, ENV_KEY_RE, "环境变量");
		if (e) errors.env = e;
	} else {
		const e = kvError(d.headerAdds, HEADER_KEY_RE, "请求头");
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

/** Last path segment of a cwd, for the 「当前项目」 line. */
export function projectName(cwd: string): string {
	const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || cwd;
}
