import { beforeEach, describe, expect, it } from "vitest";
import { useTurnNav } from "../../../stores/turnNav";
import { useUi } from "../../../stores/ui";
import { useSidebarStore } from "../sidebarStore";
import { openSearchRow } from "./openSearchRow";
import { makeHit, makeSession } from "./testFixtures";

beforeEach(() => {
	useSidebarStore.setState({ activeMode: "code" });
	useUi.setState({ selectedSessionId: null });
	useTurnNav.setState({ revealTurn: null });
});

describe("openSearchRow", () => {
	it("a metadata hit just selects the session", () => {
		const session = makeSession({ id: "s1" });
		openSearchRow({ key: "s1", session, hit: null, source: "meta" });
		expect(useUi.getState().selectedSessionId).toBe("s1");
		expect(useTurnNav.getState().revealTurn).toBeNull();
	});

	it("a content hit selects the session and queues a jump to the matched entry", () => {
		const session = makeSession({ id: "s1" });
		openSearchRow({ key: "s1", session, hit: makeHit("s1", { entryId: "a7" }), source: "content" });
		expect(useUi.getState().selectedSessionId).toBe("s1");
		expect(useTurnNav.getState().revealTurn).toMatchObject({ sessionId: "s1", userItemId: "a7" });
	});

	it("switches space first when the session belongs to another mode", () => {
		const session = makeSession({ id: "s2", mode: "study" });
		openSearchRow({ key: "s2", session, hit: makeHit("s2"), source: "content" });
		expect(useSidebarStore.getState().activeMode).toBe("study");
		// the mode switch drops the previous selection; the target must win afterwards
		expect(useUi.getState().selectedSessionId).toBe("s2");
	});
});
