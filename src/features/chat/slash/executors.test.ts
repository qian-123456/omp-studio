import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPrompt = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../send", () => ({ sendPrompt }));
vi.mock("../../../lib/ipc", () => ({ rpcSend: vi.fn(async () => ({})) }));

import { runSlashInput, type SlashDeps } from "./executors";

const deps: SlashDeps = {
	openModelPicker: vi.fn(),
	openThinkingPicker: vi.fn(),
	openContextPopover: vi.fn(),
	insertText: vi.fn(),
};

describe("runSlashInput outcome", () => {
	beforeEach(() => sendPrompt.mockClear());

	it("reports 'sent' when the registry command forwards a prompt", async () => {
		expect(await runSlashInput("s1", "/plan refactor it", deps)).toBe("sent");
		expect(sendPrompt).toHaveBeenCalledTimes(1);
	});

	it("reports null for unknown commands", async () => {
		expect(await runSlashInput("s1", "/definitely-not-a-command x", deps)).toBeNull();
	});
});
