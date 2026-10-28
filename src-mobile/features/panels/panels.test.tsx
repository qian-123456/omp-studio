// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import { loadUnsent, saveUnsent } from "../chat/lib/unsent";
import { FilesPage } from "./FilesPage";
import { gitCommitSuggest } from "./GitPage";
import { HANDBACK_MARKER, HANDBACK_PROMPT, SIDECHAT_DRAFT_PREFIX, SidechatPage } from "./SidechatPage";

describe("gitCommitSuggest", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("posts to suggest endpoint and returns suggestion text", async () => {
		const apiSpy = vi.spyOn(apiModule, "api").mockResolvedValueOnce({ suggestion: "feat(panels): add mobile panels" });

		const result = await gitCommitSuggest("/sessions/s1/git");
		expect(apiSpy).toHaveBeenCalledWith("POST", "/sessions/s1/git/suggest");
		expect(result).toBe("feat(panels): add mobile panels");
	});

	it("returns empty string when suggestion is missing", async () => {
		vi.spyOn(apiModule, "api").mockResolvedValueOnce({});
		const result = await gitCommitSuggest("/sessions/s1/git");
		expect(result).toBe("");
	});
});

describe("Sidechat Handback", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("defines valid HANDBACK_MARKER and HANDBACK_PROMPT", () => {
		expect(HANDBACK_MARKER).toBe("【回传整理】");
		expect(HANDBACK_PROMPT).toContain("【回传整理】");
		expect(HANDBACK_PROMPT).toContain("请把我们在这个辅助对话里讨论并确定下来的内容");
	});

	it("stages conclusion into parent composer draft using saveUnsent", () => {
		const parentId = "parent-sess-123";
		const conclusion = "最终方案：选用方案 B，采用纯客户端状态同步。";
		const note = `[来自辅助对话：方案讨论]\n> ${conclusion}`;

		// Pre-existing draft in parent
		saveUnsent(parentId, "原有草稿");
		const prev = loadUnsent(parentId);
		const combined = prev ? `${prev}\n\n${note}` : note;
		saveUnsent(parentId, combined);

		const updated = loadUnsent(parentId);
		expect(updated).toContain("原有草稿");
		expect(updated).toContain("[来自辅助对话：方案讨论]");
		expect(updated).toContain(conclusion);
	});
});

describe("panel presentation contracts", () => {
	afterEach(() => {
		cleanup();
		sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("preserves the annotation sessionStorage handoff and consumes it once", async () => {
		const quote = "请解释这段实现：\n> const answer = 42;";
		const key = `${SIDECHAT_DRAFT_PREFIX}parent`;
		sessionStorage.setItem(key, quote);
		vi.spyOn(apiModule, "api").mockResolvedValue([]);
		render(<SidechatPage route={{ name: "sidechat", path: "/s/parent/sidechat", params: { id: "parent" }, query: {} }} />);
		await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(quote));
		expect(sessionStorage.getItem(key)).toBeNull();
		expect(screen.getByRole("button", { name: "发送" }).className).toContain("h-11");
	});

	it("keeps long file names readable in content instead of squeezing the header", async () => {
		const name = `${"非常长的中文文件名称".repeat(6)}.ts`;
		vi.spyOn(apiModule, "api").mockImplementation(async (_method, path) =>
			path.includes("/file?")
				? { path: `/workspace/${name}`, size: 12, binary: false, truncated: false, text: "const a = 1;" }
				: { path: "/workspace", parent: null, entries: [{ name, path: `/workspace/${name}`, kind: "file", size: 12 }] },
		);
		render(<FilesPage route={{ name: "files", path: "/s/parent/files", params: { id: "parent" }, query: {} }} />);
		fireEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
		const heading = await screen.findByRole("heading", { name });
		expect(heading.closest("header")).toBeNull();
		expect(screen.getByText("文件预览")).toBeTruthy();
	});
});
