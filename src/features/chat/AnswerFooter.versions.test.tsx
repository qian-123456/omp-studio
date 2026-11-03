// @vitest-environment jsdom
/** The answer footer's sibling-version switcher: visible shape only when the
 * answer has siblings, and clicks navigate the session tree. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ navigateTree: vi.fn() }));
vi.mock("./treeNav", () => ({ navigateTree: h.navigateTree }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), copyText: vi.fn(), errMsg: String }));
vi.mock("../../lib/ipc", () => ({ gitUndoTurn: vi.fn() }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../stores/turnNav", () => ({ useTurnNav: { getState: () => ({ showCommit: vi.fn() }) } }));
vi.mock("../../stores/ui", () => ({ useUi: { getState: () => ({ openModal: vi.fn() }) } }));
vi.mock("../sessions/forkDraft", () => ({ startFork: vi.fn() }));

import { AnswerFooter } from "./AnswerFooter";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function mount(versions?: { index: number; total: number; ids: string[] }) {
	render(<AnswerFooter sessionId="s1" cwd="/r" sessionFile="/s.jsonl" answerText="answer" answerItemId="a1" versions={versions} />);
}

describe("answer version switcher", () => {
	it("does not render without siblings", () => {
		mount(undefined);
		expect(screen.queryByTitle("当前是第 1 个版本，共 2 个")).toBeNull();
	});

	it("shows a bordered n/N pill for a sibling group and highlights the current version", () => {
		mount({ index: 1, total: 3, ids: ["a0", "a1", "a2"] });
		expect(screen.getByText("2/3")).not.toBeNull();
	});

	it("navigates to the previous/next sibling", () => {
		h.navigateTree.mockResolvedValue({ cancelled: false });
		mount({ index: 1, total: 3, ids: ["a0", "a1", "a2"] });
		fireEvent.click(screen.getByRole("button", { name: "查看上一个版本" }));
		expect(h.navigateTree).toHaveBeenCalledWith("s1", "a0");
		fireEvent.click(screen.getByRole("button", { name: "查看下一个版本" }));
		expect(h.navigateTree).toHaveBeenCalledWith("s1", "a2");
	});
});
