import { describe, expect, it } from "vitest";
import { useLive } from "../../../stores/live";
import { isCommandRunning, trackCommand } from "./track";

const rows = (sid: string) => useLive.getState().sessions[sid]?.commandOutputs ?? [];

describe("trackCommand", () => {
	it("goes running → done in one row and ignores a concurrent repeat", async () => {
		let release: (t: string) => void = () => {};
		const gate = new Promise<string>((r) => {
			release = r;
		});
		const p = trackCommand("t1", "x", "正在执行", () => gate);
		expect(isCommandRunning("t1", "x")).toBe(true);
		await trackCommand("t1", "x", "正在执行", async () => "second");
		expect(rows("t1").map((r) => r.status)).toEqual(["running"]);
		release("完成");
		await p;
		expect(rows("t1")).toHaveLength(1);
		expect(rows("t1")[0]).toMatchObject({ status: "done", text: "完成" });
		expect(isCommandRunning("t1", "x")).toBe(false);
	});

	it("turns a failure into an error row", async () => {
		await trackCommand("t2", "y", "正在执行", async () => {
			throw new Error("boom");
		});
		expect(rows("t2")[0]).toMatchObject({ status: "error" });
		expect(rows("t2")[0].text).toContain("boom");
	});
});
