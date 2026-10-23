import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "./sidebarStore";
import { switchSpaceMode } from "./switchMode";

describe("switchSpaceMode", () => {
	beforeEach(() => {
		useSidebarStore.setState({ activeMode: "chat" });
		useUi.setState({
			selectedSessionId: "s1",
			selectedIds: new Set(["s1"]),
			highlightId: "s1",
			lastSessionId: "s1",
			centerView: "session",
		});
	});

	it("leaves the current session so the new mode starts blank", () => {
		switchSpaceMode("research");
		expect(useSidebarStore.getState().activeMode).toBe("research");
		const ui = useUi.getState();
		expect(ui.selectedSessionId).toBeNull();
		expect(ui.lastSessionId).toBeNull();
		expect(ui.centerView).toBe("home");
	});

	it("is a no-op when switching to the active mode", () => {
		switchSpaceMode("chat");
		expect(useUi.getState().selectedSessionId).toBe("s1");
		expect(useUi.getState().centerView).toBe("session");
	});
});
