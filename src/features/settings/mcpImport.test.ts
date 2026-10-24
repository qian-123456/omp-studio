import { describe, expect, it } from "vitest";
import { describeEntry, importSkipReason, parseMcpImport, type ImportParse } from "./mcpImport";

const names = (r: ImportParse) =>
	r.kind === "servers" ? r.servers.map((s) => s.name) : [];

describe("parseMcpImport", () => {
	it("reads mcpServers", () => {
		const r = parseMcpImport('{"mcpServers":{"fs":{"command":"npx","args":["-y","x"],"enabled":false}}}');
		expect(names(r)).toEqual(["fs"]);
		if (r.kind === "servers") expect(r.servers[0]!.entry).toEqual({ command: "npx", args: ["-y", "x"] });
	});

	it("reads VS Code servers and mcp.servers", () => {
		expect(names(parseMcpImport('{"servers":{"a":{"url":"https://x/mcp"}}}'))).toEqual(["a"]);
		expect(names(parseMcpImport('{"mcp":{"servers":{"b":{"command":"x"}}}}'))).toEqual(["b"]);
	});

	it("reads a bare name map", () => {
		expect(names(parseMcpImport('{"a":{"command":"x"},"b":{"url":"https://y"}}'))).toEqual(["a", "b"]);
	});

	it("recognises a single entry", () => {
		expect(parseMcpImport('{"command":"npx","args":["a"]}').kind).toBe("single");
		expect(parseMcpImport('{"url":"https://x/mcp"}').kind).toBe("single");
	});

	it("tolerates comments and trailing commas but keeps URLs in strings", () => {
		const r = parseMcpImport(`{
			// my servers
			"mcpServers": {
				/* block */ "a": { "url": "https://x/mcp//y", "args": ["//not-a-comment",], },
			},
		}`);
		expect(names(r)).toEqual(["a"]);
		if (r.kind === "servers") expect(r.servers[0]!.entry.url).toBe("https://x/mcp//y");
	});

	it("reports invalid or empty input", () => {
		expect(parseMcpImport("{oops").kind).toBe("error");
		expect(parseMcpImport("").kind).toBe("error");
		expect(parseMcpImport("[1]").kind).toBe("error");
		expect(parseMcpImport('{"mcpServers":{}}').kind).toBe("error");
		expect(parseMcpImport('{"a":1}').kind).toBe("error");
	});
});

describe("importSkipReason / describeEntry", () => {
	it("skips duplicates, bad names and empty entries", () => {
		expect(importSkipReason("fs", { command: "x" }, ["fs"])).toBe("名称已存在");
		expect(importSkipReason("bad name", { command: "x" }, [])).toBe("名称不合法");
		expect(importSkipReason("ok", {}, [])).toBe("缺少命令或地址");
		expect(importSkipReason("ok", { url: "https://x" }, ["fs"])).toBeNull();
	});

	it("describes transport and endpoint", () => {
		expect(describeEntry({ command: "npx", args: ["-y", "p"] })).toEqual({
			transport: "本地命令",
			endpoint: "npx -y p",
		});
		expect(describeEntry({ url: "https://x" })).toEqual({ transport: "HTTP", endpoint: "https://x" });
		expect(describeEntry({ type: "sse", url: "https://x" }).transport).toBe("SSE");
	});
});
