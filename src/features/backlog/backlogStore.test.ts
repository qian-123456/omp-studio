import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem } from "../../lib/contracts";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";

const item = (over: Partial<BacklogItem> = {}): BacklogItem => ({
	id: "b1",
	text: "Fix the top bar overflow issue",
	kind: "bug",
	status: "inbox",
	refs: [],
	targetSessionId: null,
	projectDir: null,
	createdAt: "2026-09-26T00:00:00Z",
	updatedAt: "2026-09-26T00:00:00Z",
	...over,
});

const { backlogList, onBacklogChanged } = vi.hoisted(() => ({
	backlogList: vi.fn(),
	onBacklogChanged: vi.fn(),
}));

vi.mock("../../lib/toast", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("../../lib/ipc", () => ({ backlogList }));

vi.mock("../../lib/events", () => ({ onBacklogChanged }));

describe("useBacklog store", () => {
	// The store subscribes on first load(); capture the callback across tests.
	const captured: { listener: (() => void) | null } = { listener: null };

	beforeEach(() => {
		useBacklog.setState({ items: [], loading: false });
		useComposer.setState({ drafts: {}, focusNonce: {} });
		useUi.setState({ selectedSessionId: null, centerView: "home" });
		backlogList.mockReset().mockResolvedValue([]);
		onBacklogChanged.mockReset().mockImplementation(async (cb: () => void) => {
			captured.listener = cb;
			return () => {};
		});
		vi.clearAllMocks();
	});

	it("initializes with empty items and loading=false", () => {
		expect(useBacklog.getState().items).toEqual([]);
		expect(useBacklog.getState().loading).toBe(false);
	});

	it("load fetches items, flips loading, and subscribes to change events once", async () => {
		backlogList.mockResolvedValue([item(), item({ id: "b2", status: "done" })]);

		await useBacklog.getState().load();

		expect(backlogList).toHaveBeenCalledTimes(1);
		expect(useBacklog.getState().items).toHaveLength(2);
		expect(useBacklog.getState().loading).toBe(false);
		expect(onBacklogChanged).toHaveBeenCalledTimes(1);

		// Subsequent loads reuse the single event subscription.
		await useBacklog.getState().load();
		expect(onBacklogChanged).toHaveBeenCalledTimes(1);
	});

	it("a backlog:changed event triggers a reload", async () => {
		await useBacklog.getState().load();
		expect(captured.listener).not.toBeNull();

		backlogList.mockResolvedValue([item()]);
		captured.listener?.();
		await vi.waitFor(() => {
			expect(useBacklog.getState().items).toHaveLength(1);
		});
		expect(backlogList).toHaveBeenCalledTimes(2);
	});

	it("handles fill current session workflow correctly", () => {
		const targetItem = item();

		// 1. When no session is selected
		const handleFillCurrent = (target: BacklogItem) => {
			const selectedSessionId = useUi.getState().selectedSessionId;
			if (!selectedSessionId) {
				toast.error("没有选中的会话");
				return;
			}
			useComposer.getState().setDraft(selectedSessionId, target.text);
			useComposer.getState().focusComposer(selectedSessionId);
			useUi.getState().selectSession(selectedSessionId);
			toast.success("已填入输入框");
		};

		handleFillCurrent(targetItem);
		expect(toast.error).toHaveBeenCalledWith("没有选中的会话");

		// 2. When session is selected
		useUi.setState({ selectedSessionId: "session-123" });
		handleFillCurrent(targetItem);

		expect(useComposer.getState().drafts["session-123"]).toBe(
			"Fix the top bar overflow issue",
		);
		expect(useComposer.getState().focusNonce["session-123"]).toBe(1);
		expect(useUi.getState().centerView).toBe("session");
		expect(toast.success).toHaveBeenCalledWith("已填入输入框");
	});
});
