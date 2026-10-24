import { describe, expect, it } from "vitest";
import { modelSwitchNotice } from "./modelSwitchNotice";

describe("modelSwitchNotice", () => {
	it("keeps the plain toast when idle", () => {
		expect(modelSwitchNotice("p/m", false)).toEqual({ kind: "success", text: "已切换模型" });
	});
	it("states that a running turn keeps the old model", () => {
		const n = modelSwitchNotice("p/gem", true);
		expect(n.kind).toBe("info");
		expect(n.text).toContain("gem");
		expect(n.text).toContain("下一轮");
	});
});
