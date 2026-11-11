// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./IdeaEditor", () => ({ IdeaTextView: () => <div>idea text</div> }));
vi.mock("./IdeaEditBox", () => ({ IdeaEditBox: () => <div>edit box</div> }));
vi.mock("./ideasActions", () => ({
	deleteIdeas: vi.fn(),
	purgeIdeas: vi.fn(),
	restoreIdeas: vi.fn(),
	setIdeasStatus: vi.fn(),
}));

import type { BacklogItem } from "../../lib/contracts";
import { IdeaRow, type IdeaRowProps } from "./IdeaRow";

const item: BacklogItem = {
	id: "i1",
	text: "hello",
	kind: "idea",
	refs: [],
	status: "inbox",
	targetSessionId: null,
	projectDir: null,
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	deletedAt: null,
};

function props(over: Partial<IdeaRowProps> = {}): IdeaRowProps {
	return {
		item,
		phase: "pending",
		linked: undefined,
		checked: true,
		selecting: true,
		editing: false,
		editingKind: "idea",
		editingProject: "",
		canFill: false,
		opening: false,
		onToggle: vi.fn(),
		onEditKindChange: vi.fn(),
		onEditProjectChange: vi.fn(),
		onStartEdit: vi.fn(),
		onSaveEdit: vi.fn(),
		onCancelEdit: vi.fn(),
		onFill: vi.fn(),
		onOpenInNewSession: vi.fn(),
		onOpenSession: vi.fn(),
		...over,
	};
}

afterEach(cleanup);

describe("IdeaRow while multi-selecting", () => {
	it("keeps the edit button, starts editing without toggling the checkbox, and hides delete", () => {
		const p = props();
		render(<IdeaRow {...p} />);
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect(p.onStartEdit).toHaveBeenCalledTimes(1);
		expect(p.onToggle).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
	});

	it("still offers delete when nothing is selected", () => {
		render(<IdeaRow {...props({ selecting: false, checked: false })} />);
		expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "删除" })).toBeTruthy();
	});

	it("keeps compact draft actions together and disables only new conversation while opening", () => {
		const p = props({ selecting: false, checked: false, canFill: true, opening: true });
		render(<IdeaRow {...p} />);
		const fill = screen.getByRole("button", { name: "填入当前" }) as HTMLButtonElement;
		const open = screen.getByRole("button", { name: "新会话" }) as HTMLButtonElement;
		expect(fill.disabled).toBe(false);
		expect(open.disabled).toBe(true);
		expect(fill.title).toBe("填入当前会话输入框");
		expect(open.title).toBe("在新会话中准备草稿，确认后再发送");
		expect(fill.classList.contains("whitespace-nowrap")).toBe(true);
		expect(open.classList.contains("whitespace-nowrap")).toBe(true);
		expect(fill.parentElement).toBe(open.parentElement);
		fireEvent.click(fill);
		fireEvent.click(open);
		expect(p.onFill).toHaveBeenCalledTimes(1);
		expect(p.onOpenInNewSession).not.toHaveBeenCalled();
		expect(p.onToggle).not.toHaveBeenCalled();
	});
});
