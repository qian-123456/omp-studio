import { describe, expect, it } from "vitest";
import type { McpServerItem } from "../../lib/contracts";
import { buildPatch, draftFrom, validateDraft } from "./mcpDraft";

const existing: McpServerItem = {
	name: "fs",
	transport: "stdio",
	command: "npx",
	args: ["-y", "pkg"],
	url: null,
	cwd: null,
	timeoutMs: 5000,
	instructions: true,
	enabled: true,
	shadowed: false,
	denylisted: false,
	allowlisted: false,
	env: [{ key: "TOKEN", value: null, masked: true }],
	headers: [],
	hasAuth: false,
	hasOauth: false,
	sourceFile: "/u/mcp.json",
	scope: "user",
	error: null,
};

describe("validateDraft", () => {
	it("requires name and command for a new stdio server", () => {
		const errors = validateDraft(draftFrom(null, "/u/mcp.json"), []);
		expect(errors.name).toBeDefined();
		expect(errors.command).toBeDefined();
	});

	it("rejects duplicate names in the same file but allows keeping the original name", () => {
		const add = { ...draftFrom(null, "/u/mcp.json"), name: "fs", command: "x" };
		expect(validateDraft(add, ["fs"]).name).toContain("已存在");
		expect(validateDraft(draftFrom(existing, ""), ["fs"])).toEqual({});
	});

	it("validates remote url, timeout and header keys", () => {
		const d = {
			...draftFrom(null, "/u/mcp.json"),
			name: "remote",
			type: "http" as const,
			url: "example.com/mcp",
			timeout: "1.5",
			headerAdds: [{ key: "Bad Key", value: "v" }],
		};
		const errors = validateDraft(d, []);
		expect(errors.url).toBeDefined();
		expect(errors.timeout).toBeDefined();
		expect(errors.headers).toBeDefined();
		expect(validateDraft({ ...d, url: "https://example.com/mcp", timeout: "3000", headerAdds: [{ key: "Authorization", value: "x" }] }, [])).toEqual({});
	});

	it("flags duplicate or nameless env rows but ignores fully empty rows", () => {
		const base = { ...draftFrom(null, "/u/mcp.json"), name: "a", command: "npx" };
		expect(validateDraft({ ...base, envAdds: [{ key: "", value: "" }] }, [])).toEqual({});
		expect(validateDraft({ ...base, envAdds: [{ key: "", value: "v" }] }, []).env).toBeDefined();
		expect(
			validateDraft({ ...base, envAdds: [{ key: "A", value: "1" }, { key: "A", value: "2" }] }, []).env,
		).toBeDefined();
	});
});

describe("buildPatch", () => {
	it("merges env adds/removes and clears remote fields for stdio", () => {
		const d = draftFrom(existing, "");
		d.envRemoves = new Set(["TOKEN"]);
		d.envAdds = [{ key: "NEW", value: "v" }];
		d.timeout = "";
		const patch = buildPatch(d);
		expect(patch.env).toEqual({ TOKEN: null, NEW: "v" });
		expect(patch.url).toBeNull();
		expect(patch.args).toEqual(["-y", "pkg"]);
		expect(patch.timeout).toBeNull();
	});

	it("switching to http drops command/env", () => {
		const d = { ...draftFrom(existing, ""), type: "http" as const, url: "https://x/mcp" };
		const patch = buildPatch(d);
		expect(patch).toMatchObject({ type: "http", url: "https://x/mcp", command: null, env: null, args: null });
	});
});
