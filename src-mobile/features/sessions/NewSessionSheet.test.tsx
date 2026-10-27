// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const createSession = vi.fn();
const push = vi.fn();

vi.mock("../../core/api", () => ({
	api: (...a: unknown[]) => apiMock(...a),
	errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
}));
vi.mock("../../core/nav", () => ({
	nav: { push: (...a: unknown[]) => push(...a), pushLayer: () => () => {} },
	paths: { chat: (id: string) => `/s/${id}` },
}));
vi.mock("../../core/stores/sessions", () => ({
	useSessions: { getState: () => ({ createSession }) },
}));

import { NewSessionSheet } from "./NewSessionSheet";

const DIRS = [
	{ path: "/p/a", label: "alpha", kind: "workspace", mode: "code", workspaceId: "wa" },
	{ path: "/p/b", label: "beta", kind: "workspace", mode: "code", workspaceId: "wb" },
];
const MODELS = [
	{ provider: "anthropic", id: "opus", name: "Opus", thinking: ["low", "high"] },
	{ provider: "anthropic", id: "haiku", name: "Haiku", thinking: [] },
];

beforeEach(() => {
	apiMock.mockImplementation(async (_m: string, path: string) => {
		if (path === "/left/dirs") return { dirs: DIRS };
		if (path.startsWith("/left/roles")) return { models: MODELS };
		if (path === "/left/settings") return { defaultModel: "anthropic/opus" };
		throw new Error(`unexpected ${path}`);
	});
	createSession.mockResolvedValue({ id: "mobile-draft-1", mode: "code", cwd: "/p/b" });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("NewSessionSheet", () => {
	it("preselects defaultCwd, walks to the model step, keeps choices on 上一步 and creates with them", async () => {
		const onClose = vi.fn();
		render(<NewSessionSheet open onClose={onClose} defaultCwd="/p/b" />);

		const beta = await screen.findByRole("radio", { name: /beta/ });
		await waitFor(() => expect(beta.getAttribute("aria-checked")).toBe("true"));

		fireEvent.click(screen.getByRole("button", { name: "下一步" }));
		const opus = await screen.findByRole("option", { name: /Opus/ });
		expect(screen.queryByRole("button", { name: "上一步" })).not.toBeNull();
		expect(apiMock).toHaveBeenCalledWith("GET", "/left/roles?cwd=%2Fp%2Fb");

		fireEvent.click(opus);
		fireEvent.click(await screen.findByRole("button", { name: "high" }));

		fireEvent.click(screen.getByRole("button", { name: "上一步" }));
		expect((await screen.findByRole("radio", { name: /beta/ })).getAttribute("aria-checked")).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "下一步" }));
		expect((await screen.findByRole("button", { name: "high" })).getAttribute("aria-pressed")).toBe("true");
		// catalog is cached per directory: one fetch only
		expect(apiMock.mock.calls.filter((c) => String(c[1]).startsWith("/left/roles"))).toHaveLength(1);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "创建会话" }));
		});
		expect(createSession).toHaveBeenCalledWith({
			cwd: "/p/b",
			mode: "code",
			model: { provider: "anthropic", modelId: "opus" },
			thinking: "high",
		});
		expect(push).toHaveBeenCalledWith("/s/mobile-draft-1");
		expect(onClose).toHaveBeenCalled();
	});

	it("「直接创建」 skips the model step and sends no model", async () => {
		render(<NewSessionSheet open onClose={() => {}} />);
		const alpha = await screen.findByRole("radio", { name: /alpha/ });
		const direct = screen.getByRole("button", { name: "直接创建" }) as HTMLButtonElement;
		expect(direct.disabled).toBe(true);
		fireEvent.click(alpha);
		expect(direct.disabled).toBe(false);
		await act(async () => {
			fireEvent.click(direct);
		});
		expect(createSession).toHaveBeenCalledWith({ cwd: "/p/a", mode: "code" });
	});
});
