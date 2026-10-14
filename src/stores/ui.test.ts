// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "./ui";

describe("useUi right panel", () => {
	beforeEach(() => {
		localStorage.clear();
		useUi.setState({
			rightOpen: true,
			rightTab: null,
			openRightTabs: [],
		});
	});

	it("restores the previously active tab on collapse then expand", () => {
		useUi.getState().setRightTab("git");
		useUi.getState().toggleRight(); // collapse
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().rightTab).toBe("git");
		useUi.getState().toggleRight(); // expand
		expect(useUi.getState().rightOpen).toBe(true);
		expect(useUi.getState().rightTab).toBe("git");
	});

	it("shows the picker only when no tab was active", () => {
		useUi.getState().toggleRight(); // collapse
		useUi.getState().toggleRight(); // expand
		expect(useUi.getState().rightOpen).toBe(true);
		expect(useUi.getState().rightTab).toBeNull();
	});

	it("expands to the neighbour activated by closing the active tab", () => {
		useUi.getState().setRightTab("todos");
		useUi.getState().setRightTab("git");
		// Active "git"; close it while expanded → "todos" becomes active.
		useUi.getState().closeRightTab("git");
		expect(useUi.getState().rightTab).toBe("todos");
		useUi.getState().toggleRight(); // collapse
		useUi.getState().toggleRight(); // expand
		expect(useUi.getState().rightTab).toBe("todos");
	});

	it("persists the restored active tab for the next launch", () => {
		useUi.getState().setRightTab("terminal");
		useUi.getState().toggleRight(); // collapse
		useUi.getState().toggleRight(); // expand
		expect(localStorage.getItem("ompws:right-tab")).toBe("terminal");
	});
});
