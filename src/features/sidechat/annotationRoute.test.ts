import { describe, expect, it } from "vitest";
import { mainKeyOfSideChat, resolveAnnotationKey, sideChatStageKey } from "./annotationRoute";

describe("annotation routing", () => {
	const view = { openChild: { p1: "child-1" } };

	it("main selection follows the remembered target", () => {
		expect(resolveAnnotationKey({ sessionId: "p1", inSideChat: false, target: "main", view })).toBe("p1");
		expect(resolveAnnotationKey({ sessionId: "p1", inSideChat: false, target: "sidechat", view })).toBe("child-1");
	});

	it("falls back to the blank-tab key when no side-chat tab is open", () => {
		expect(sideChatStageKey("p2", view)).toBe("sidechat:p2");
		expect(resolveAnnotationKey({ sessionId: "p2", inSideChat: false, target: "sidechat", view })).toBe("sidechat:p2");
	});

	it("a blank active tab stages under the parent key", () => {
		expect(sideChatStageKey("p1", { openChild: { p1: "new:abc" } })).toBe("sidechat:p1");
	});

	it("selection inside a side chat never offers a choice", () => {
		expect(resolveAnnotationKey({ sessionId: "child-1", inSideChat: true, target: "sidechat", view })).toBe("child-1");
	});

	it("maps side-chat keys back to the main session", () => {
		expect(mainKeyOfSideChat("sidechat:p1", null)).toBe("p1");
		expect(mainKeyOfSideChat("child-1", "p1")).toBe("p1");
		expect(mainKeyOfSideChat("x", null)).toBeNull();
	});
});
