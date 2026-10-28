import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
vi.mock("../../../core/api", () => ({ api: (...args: unknown[]) => apiMock(...args), errorMessage: String }));

import { sessionModelSource } from "./useModelFacts";

beforeEach(() => apiMock.mockReset());

describe("session model source", () => {
	it("uses the provider/modelId API contract for a model selection", async () => {
		apiMock.mockResolvedValue({ current: { provider: "openai", id: "gpt-test" }, thinkingLevel: "high", liveThinking: ["low", "high"] });
		const facts = await sessionModelSource("s1").setModel({ provider: "openai", id: "gpt-test" });
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/model", { provider: "openai", modelId: "gpt-test" });
		expect(facts.thinkingLevel).toBe("high");
	});

	it("normalizes empty catalog arrays and sends thinking independently", async () => {
		apiMock.mockResolvedValue({ current: null, thinkingLevel: null });
		const source = sessionModelSource("s2");
		expect(await source.load()).toMatchObject({ models: [], liveThinking: [] });
		await source.setThinking("low");
		expect(apiMock).toHaveBeenLastCalledWith("POST", "/sessions/s2/thinking", { level: "low" });
	});
});
