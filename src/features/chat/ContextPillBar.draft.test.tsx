// @vitest-environment jsdom
/** New-chat draft: pill bar shows project/branch without spawning; git actions start the draft's own session. */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { usePendingSession } from "../sessions/pendingSession";
import { ContextPillBar } from "./ContextPillBar";

const DRAFT = "local-draft:pill-1";

const h = vi.hoisted(() => ({
	prewarm: vi.fn(async (_id: string) => "real-9"),
	bash: vi.fn(async (_id: string, _cmd: string) => ""),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		gitBadge: vi.fn(async () => ({ branch: "omp/bug-fix" })),
		gitRepoRoot: vi.fn(async () => "/tmp/proj"),
		gitListBranchesDetailed: vi.fn(async () => [{ name: "main", displayName: "main", isRemote: false }]),
		gitListWorktrees: vi.fn(async () => []),
	};
});
vi.mock("../sessions/draftSession", () => ({ prewarmDraft: h.prewarm }));
vi.mock("./sessionShell", async (importOriginal) => ({
	...(await importOriginal<typeof import("./sessionShell")>()),
	runSessionBash: h.bash,
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});

beforeEach(() => {
	localStorage.clear();
	h.prewarm.mockClear();
	h.bash.mockClear();
	usePendingSession.setState({
		drafts: {
			[DRAFT]: {
				id: DRAFT, cwd: "/tmp/proj", mode: "code", groupId: null,
				opts: { cwd: "/tmp/proj" } as never, model: null, thinking: null,
				sessionId: null, startError: null,
			},
		},
		selectedId: DRAFT,
	});
});
afterEach(() => cleanup());

const mount = () =>
	render(<ContextPillBar sessionId={DRAFT} onWorkspaceClick={() => {}} workspaceBtnRef={{ current: null }} />);

describe("ContextPillBar on a local draft", () => {
	it("shows the cwd's branch without starting a session", async () => {
		mount();
		expect(await screen.findByText("omp/bug-fix")).toBeTruthy();
		expect(h.prewarm).not.toHaveBeenCalled();
	});

	it("checkout resolves the draft's retained session before running git", async () => {
		mount();
		fireEvent.click(await screen.findByText("omp/bug-fix"));
		fireEvent.click(await screen.findByText("main"));
		await waitFor(() => expect(h.bash).toHaveBeenCalled());
		expect(h.prewarm).toHaveBeenCalledWith(DRAFT);
		expect(h.bash.mock.calls[0]?.[0]).toBe("real-9");
		expect(h.bash.mock.calls[0]?.[1]).toContain("git checkout");
	});
});
