import { describe, expect, it } from "vitest";
import type { PickerModel } from "../../ui/ModelPicker";
import { createInput, initialNewSession, newSessionReducer as r, preselectCwd, type NewSessionState } from "./newSession";
import type { DirEntry } from "./tree";

const dirs: DirEntry[] = [
	{ path: "/p/a", label: "a", kind: "workspace", mode: "code", workspaceId: "wa" },
	{ path: "/p/a/.wt/x", label: "x", kind: "worktree", mode: "code", workspaceId: "wa" },
	{ path: "/g", label: "无项目", kind: "global", mode: "chat", workspaceId: "wg" },
];
const claude: PickerModel = { provider: "anthropic", id: "opus", thinking: ["low", "high"] };
const plain: PickerModel = { provider: "x", id: "plain", thinking: [] };

describe("new-session wizard state", () => {
	it("cannot advance without a directory", () => {
		const s = initialNewSession();
		expect(r(s, { type: "next" }).step).toBe("dir");
		expect(r(r(s, { type: "pickDir", cwd: "/p/a" }), { type: "next" }).step).toBe("model");
	});

	it("going back keeps directory, model and thinking", () => {
		let s: NewSessionState = initialNewSession();
		s = r(s, { type: "pickDir", cwd: "/p/a" });
		s = r(s, { type: "next" });
		s = r(s, { type: "pickModel", model: claude });
		s = r(s, { type: "setThinking", level: "high" });
		s = r(s, { type: "back" });
		expect(s).toEqual({ step: "dir", cwd: "/p/a", model: { provider: "anthropic", modelId: "opus" }, thinking: "high" });
		s = r(s, { type: "next" });
		expect(s.step).toBe("model");
		expect(s.thinking).toBe("high");
	});

	it("back on the first step is a no-op", () => {
		const s = r(initialNewSession("/p/a"), { type: "back" });
		expect(s.step).toBe("dir");
		expect(s.cwd).toBe("/p/a");
	});

	it("switching to a model that lacks the chosen thinking level resets it to auto", () => {
		let s = r(initialNewSession("/p/a"), { type: "pickModel", model: claude });
		s = r(s, { type: "setThinking", level: "low" });
		expect(r(s, { type: "pickModel", model: plain }).thinking).toBeNull();
		expect(r(s, { type: "pickModel", model: { ...claude, id: "sonnet" } }).thinking).toBe("low");
		expect(r(s, { type: "pickModel", model: null })).toMatchObject({ model: null, thinking: null });
	});

	it("preselects the default cwd only when it is an offered directory", () => {
		expect(preselectCwd(dirs, "/p/a/.wt/x")).toBe("/p/a/.wt/x");
		expect(preselectCwd(dirs, "/elsewhere")).toBeNull();
		expect(preselectCwd(dirs, undefined)).toBeNull();
	});

	it("create input: default model sends no model/thinking; explicit model carries thinking; global dir → chat mode", () => {
		const base = { step: "model", cwd: "/p/a", model: null, thinking: "high" } as NewSessionState;
		expect(createInput(base, dirs)).toEqual({ cwd: "/p/a", mode: "code" });
		const picked = { ...base, model: { provider: "anthropic", modelId: "opus" } };
		expect(createInput(picked, dirs)).toEqual({ cwd: "/p/a", mode: "code", model: picked.model, thinking: "high" });
		expect(createInput({ ...base, cwd: "/g" }, dirs)?.mode).toBe("chat");
		expect(createInput(initialNewSession(), dirs)).toBeNull();
	});
});
