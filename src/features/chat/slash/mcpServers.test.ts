import { describe, expect, it } from "vitest";
import type { McpServerItem } from "../../../lib/contracts";
import {
	applyMcpServerName,
	buildMcpServerItems,
	describeMcpServer,
	takesMcpServerArg,
} from "./mcpServers";

const srv = (p: Partial<McpServerItem> & { name: string }): McpServerItem =>
	({
		transport: "stdio",
		command: "npx",
		args: ["-y", "pkg"],
		url: null,
		enabled: true,
		scope: "user",
		...p,
	}) as McpServerItem;

describe("mcpServers", () => {
	it("knows which command+sub take a server name", () => {
		expect(takesMcpServerArg("mcp", "enable")).toBe(true);
		expect(takesMcpServerArg("mcp", "add")).toBe(false);
		expect(takesMcpServerArg("mcp", undefined)).toBe(false);
		expect(takesMcpServerArg("other", "enable")).toBe(false);
	});

	it("describes state, transport, endpoint and scope", () => {
		expect(describeMcpServer(srv({ name: "a" }))).toBe("已启用 · stdio · npx -y pkg · 来源: user");
		expect(
			describeMcpServer(
				srv({ name: "b", enabled: false, transport: "http", url: "https://x/mcp", scope: "project" }),
			),
		).toBe("已禁用 · http · https://x/mcp · 来源: project");
	});

	it("sorts disabled first for enable, enabled first otherwise (stable)", () => {
		const list = [
			srv({ name: "a", enabled: true }),
			srv({ name: "b", enabled: false }),
			srv({ name: "c", enabled: true }),
		];
		expect(buildMcpServerItems(list, "enable", "").map((i) => i.name)).toEqual(["b", "a", "c"]);
		expect(buildMcpServerItems(list, "disable", "").map((i) => i.name)).toEqual(["a", "c", "b"]);
	});

	it("filters prefix first, then substring", () => {
		const list = [srv({ name: "my-fs" }), srv({ name: "fs" }), srv({ name: "git" })];
		const items = buildMcpServerItems(list, "test", "fs");
		expect(items.map((i) => i.name)).toEqual(["fs", "my-fs"]);
		expect(items[0]).toMatchObject({ plain: true, group: "MCP 服务器", title: "" });
		expect(buildMcpServerItems(list, "test", "zzz")).toEqual([]);
	});

	it("applies a name to the first word", () => {
		expect(applyMcpServerName("", "beta")).toEqual({ text: "beta ", caret: 5 });
		expect(applyMcpServerName("be", "beta")).toEqual({ text: "beta ", caret: 5 });
		expect(applyMcpServerName("be rest", "beta")).toEqual({ text: "beta rest", caret: 4 });
	});
});
