import { describe, expect, it, vi } from "vitest";
import { findSlashCommand } from "./registry";
import type { SlashContext } from "./types";

function mkCtx(args: string, name: string) {
	const sendPromptText = vi.fn(async (_t: string) => {});
	const openSettingsTarget = vi.fn();
	const track = vi.fn();
	const rpcSend = vi.fn(async (_c: Record<string, unknown>) => ({}) as Record<string, unknown>);
	const pushOutput = vi.fn();
	const ctx = {
		sessionId: "s",
		live: { alive: true, state: {} },
		session: undefined,
		rawText: args ? `/${name} ${args}` : `/${name}`,
		args,
		rpcSend,
		sendPromptText,
		pushOutput,
		track,
		insertText: vi.fn(),
		openModelPicker: vi.fn(),
		openThinkingPicker: vi.fn(),
		openContextPopover: vi.fn(),
		openSettingsTarget,
		openSettings: vi.fn(),
	} as unknown as SlashContext;
	return { ctx, sendPromptText, openSettingsTarget, track, rpcSend, pushOutput };
}

/** Commands whose subcommands (from omp) must reach omp unchanged. */
const FORWARDING: [string, string][] = [
	["fast", "on"],
	["fast", "ultra"],
	["slow", "off"],
	["advisor", "status"],
	["plugins", "enable foo"],
	["memory", "stats"],
	["usage", "show"],
	["jobs", "kill 3"],
	["changelog", "last"],
	["browser", "headless"],
	["computer", "on"],
	["extended-context", "status"],
	["security", "scan"],
	["mcp", "enable foo"],
	["goal", "budget 5"],
];

describe("registry commands forward omp subcommands", () => {
	it.each(FORWARDING)("/%s %s reaches omp unchanged", async (name, args) => {
		const def = findSlashCommand(name);
		expect(def).toBeDefined();
		const m = mkCtx(args, name);
		await def?.run(m.ctx);
		expect(m.sendPromptText).toHaveBeenCalledWith(`/${name} ${args}`);
		expect(m.openSettingsTarget).not.toHaveBeenCalled();
		expect(m.track).not.toHaveBeenCalled();
		expect(m.rpcSend).not.toHaveBeenCalled();
	});

	it.each(["fast", "slow", "advisor", "plugins", "memory", "usage", "changelog", "browser", "computer", "extended-context", "mcp"])(
		"bare /%s keeps its native behaviour",
		async (name) => {
			const m = mkCtx("", name);
			await findSlashCommand(name)?.run(m.ctx);
			expect(m.sendPromptText).not.toHaveBeenCalled();
			expect(m.openSettingsTarget.mock.calls.length + m.track.mock.calls.length).toBe(1);
		},
	);
});

describe("/shake", () => {
	it("forwards to omp, then resyncs state so the context ring updates", async () => {
		const m = mkCtx("images", "shake");
		await findSlashCommand("shake")?.run(m.ctx);
		expect(m.sendPromptText).toHaveBeenCalledWith("/shake images");
		expect(m.rpcSend).toHaveBeenCalledWith({ type: "get_state" });
	});
});

describe("/goal native subcommand handling", () => {
	const run = async (args: string) => {
		const m = mkCtx(args, "goal");
		await findSlashCommand("goal")?.run(m.ctx);
		return m;
	};

	it("pause / resume / drop / off stay native", async () => {
		for (const a of ["pause", "resume", "drop", "off"]) {
			const m = await run(a);
			expect(m.track).toHaveBeenCalledTimes(1);
			expect(m.sendPromptText).not.toHaveBeenCalled();
		}
	});

	it("show prints the current goal; set <text> creates with <text>", async () => {
		const show = await run("show");
		expect(show.pushOutput).toHaveBeenCalledWith("goal", "当前没有目标");
		const set = await run("set ship it");
		expect(set.track).toHaveBeenCalledWith("goal", "正在设置目标", expect.any(Function));
		const work = set.track.mock.calls[0]?.[2] as () => Promise<string>;
		await expect(work()).resolves.toBe("已设置目标：ship it");
		expect(set.rpcSend).toHaveBeenCalledWith({ type: "goal", op: "create", objective: "ship it" });
	});

	it("free-form text still creates a goal", async () => {
		const m = await run("fix the build");
		expect(m.rpcSend).not.toHaveBeenCalled();
		const work = m.track.mock.calls[0]?.[2] as () => Promise<string>;
		await expect(work()).resolves.toBe("已设置目标：fix the build");
	});
});
