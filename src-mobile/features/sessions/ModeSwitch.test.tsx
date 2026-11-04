// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ModeSwitch } from "./ModeSwitch";
import type { TreeSession } from "./tree";
import { useTree } from "./treeStore";

afterEach(() => {
	cleanup();
});

const makeSession = (id: string): TreeSession => ({
	id,
	label: id,
	title: `Session ${id}`,
	status: "idle",
	updatedAt: "2026-11-04T12:00:00Z",
	cwd: "/p",
	live: false,
});

describe("ModeSwitch", () => {
	it("renders mode label without session count digits even when sessions exist", () => {
		useTree.setState({
			mode: "code",
			data: {
				pinned: [],
				globalGroup: null,
				workspaceGroups: [
					{
						workspace: { id: "ws-1", name: "proj", path: "/p" },
						isGlobal: false,
						totalCount: 2,
						subgroups: [
							{
								key: "sg-1",
								kind: "default",
								label: "main",
								deleted: false,
								sessions: [makeSession("s1"), makeSession("s2")],
								totalCount: 2,
							},
						],
						deletedSubgroups: [],
					},
				],
				unassignedGroups: [],
				deletedSessions: [],
				archived: [],
			},
		});

		render(<ModeSwitch />);
		const btn = screen.getByRole("button", { name: /代码/ });
		expect(btn.textContent).toContain("代码");
		expect(btn.textContent).not.toMatch(/\d+/);
	});
});
