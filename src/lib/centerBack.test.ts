import { describe, expect, it } from "vitest";
import { backLabel, resolveBackTarget, shouldEscapeGoBack } from "./centerBack";

const base = {
	view: "doc" as const,
	selectedSessionId: null,
	lastSessionId: "s1",
	sessionExists: (id: string) => id === "s1",
	placeholderShowing: false,
};

describe("resolveBackTarget", () => {
	it("returns to the remembered session from a doc", () => {
		expect(resolveBackTarget(base)).toEqual({ kind: "session", sessionId: "s1" });
	});
	it("prefers the selected session", () => {
		const t = resolveBackTarget({
			...base,
			selectedSessionId: "s2",
			sessionExists: () => true,
		});
		expect(t).toEqual({ kind: "session", sessionId: "s2" });
	});
	it("falls back to home when the session is gone", () => {
		expect(resolveBackTarget({ ...base, sessionExists: () => false })).toEqual({ kind: "home" });
	});
	it("shows nothing on session/home or with a placeholder", () => {
		expect(resolveBackTarget({ ...base, view: "session" })).toBeNull();
		expect(resolveBackTarget({ ...base, view: "home" })).toBeNull();
		expect(resolveBackTarget({ ...base, placeholderShowing: true })).toBeNull();
	});
});

describe("backLabel", () => {
	it("names the destination", () => {
		expect(backLabel({ kind: "home" }, null)).toBe("首页");
		expect(backLabel({ kind: "session", sessionId: "a" }, "标题")).toBe("标题");
		expect(backLabel({ kind: "session", sessionId: "a" }, null)).toBe("会话");
	});
});

describe("shouldEscapeGoBack", () => {
	const ok = {
		key: "Escape",
		escapeClaimed: false,
		composing: false,
		targetEditable: false,
		overlayOpen: false,
		hasBackTarget: true,
	};
	it("goes back when nothing else owns Esc", () => {
		expect(shouldEscapeGoBack(ok)).toBe(true);
	});
	it.each([
		{ escapeClaimed: true },
		{ composing: true },
		{ targetEditable: true },
		{ overlayOpen: true },
		{ hasBackTarget: false },
		{ key: "Enter" },
	])("ignores %o", (patch) => {
		expect(shouldEscapeGoBack({ ...ok, ...patch })).toBe(false);
	});
});
