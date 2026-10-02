import { describe, expect, it } from "vitest";
import type { BacklogItem, BacklogStatus } from "../../lib/contracts";
import { partitionIdeas } from "./ideasLogic";

const item = (id: string, status: BacklogStatus, projectDir: string | null, updatedAt: string): BacklogItem => ({
	id,
	text: id,
	kind: "todo",
	refs: [],
	status,
	targetSessionId: null,
	projectDir,
	createdAt: updatedAt,
	updatedAt,
});

describe("partitionIdeas", () => {
	const items = [
		item("old-here", "inbox", "/p/a", "2026-01-01T00:00:00Z"),
		item("new-other", "dispatched", "/p/b", "2026-01-03T00:00:00Z"),
		item("new-here", "dispatched", "/p/a", "2026-01-02T00:00:00Z"),
		item("global", "inbox", null, "2026-01-04T00:00:00Z"),
		item("done", "done", "/p/a", "2026-01-05T00:00:00Z"),
		item("closed", "closed", null, "2026-01-06T00:00:00Z"),
	];

	it("puts current-project items first, each group newest first", () => {
		const { active } = partitionIdeas(items, "/p/a");
		expect(active.map((i) => i.id)).toEqual(["new-here", "old-here", "global", "new-other"]);
	});

	it("without a current project sorts purely by recency; null projectDir never matches", () => {
		const { active } = partitionIdeas(items, null);
		expect(active.map((i) => i.id)).toEqual(["global", "new-other", "new-here", "old-here"]);
	});

	it("moves done and closed items to finished, newest first", () => {
		const { finished } = partitionIdeas(items, "/p/a");
		expect(finished.map((i) => i.id)).toEqual(["closed", "done"]);
	});
});
