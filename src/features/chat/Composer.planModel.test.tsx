// @vitest-environment jsdom
/**
 * Rendered Composer in plan mode: the chip shows the `plan` role's model at once, a
 * picker edit is saved to the right role scope and applied to the session, and no
 * async result (auto-apply, role read, save) leaks into another session or visit.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import type * as DraftSessionModule from "../sessions/draftSession";
import type { ModelRoleSnapshot } from "../../lib/contracts";
import type { ModelOption } from "../../lib/models";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { usePendingSession } from "../sessions/pendingSession";
import { loadChip, saveChip } from "./slash/chip";
import { Composer } from "./Composer";
import { clearAllPlanModelApplied } from "./plan/planModelApplied";

const S1 = "plan-s1";
const S2 = "plan-s2";

const MODELS: ModelOption[] = ["a", "b", "c"].map((id) => ({
	provider: "p",
	id: `model-${id}`,
	name: `model-${id}`,
	thinking: ["low", "high"],
	reasoning: true,
}));

const snap = (plan?: string, project?: string): ModelRoleSnapshot => ({
	global: { path: "/g", exists: true, modelRoles: plan ? { plan } : {}, agentModelOverrides: {} },
	project: project ? { path: "/p", exists: true, modelRoles: { plan: project }, agentModelOverrides: {} } : null,
	agents: [],
});

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_id: string, _cmd: unknown) => ({}) as Record<string, unknown>),
	rolesRead: vi.fn(async (..._a: unknown[]) => ({}) as unknown),
	rolesSet: vi.fn(async (..._a: unknown[]) => ({}) as unknown),
	materialize: vi.fn(async (_id: string) => "never"),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		rpcEnsureLive: vi.fn(async () => ({ sessionId: S1 })),
		ompModelRolesRead: h.rolesRead,
		ompModelRolesSet: h.rolesSet,
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		skillsList: vi.fn(async () => ({ skills: [], extensions: [] })),
		listWorkspaceFiles: vi.fn(async () => []),
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		listWorkspaces: vi.fn(async () => []),
		getSettings: vi.fn(async () => null),
		gitBadge: vi.fn(async () => null),
		privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "missing", nativeError: null })),
		privacySessionEntryIds: vi.fn(async () => []),
		mcpConfigList: vi.fn(async () => ({ servers: [] })),
		pluginsList: vi.fn(async () => ({ roots: [], plugins: [] })),
	};
});
vi.mock("../sessions/draftSession", async (importOriginal) => {
	const orig = await importOriginal<typeof DraftSessionModule>();
	return { ...orig, materializeDraft: h.materialize, warmDraft: () => {}, prewarmDraft: async () => S1 };
});
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("../../lib/events", async (importOriginal) => {
	const orig = await importOriginal<typeof EventsModule>();
	return { ...orig, onPrivacyChanged: async () => () => {} };
});
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => MODELS,
	useModelCatalog: Object.assign(vi.fn(() => MODELS), {
		getState: () => ({ models: MODELS, refresh: () => Promise.resolve() }),
	}),
}));
vi.mock("../../components/ModelSelect", () => ({
	ModelMenuContent: ({ onSelect }: { onSelect: (key: string) => void }) => (
		<div data-testid="model-menu">
			{MODELS.map((m) => (
				<button key={m.id} type="button" data-pick={`p/${m.id}`} onClick={() => onSelect(`p/${m.id}`)}>
					{`pick ${m.id}`}
				</button>
			))}
		</div>
	),
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	Element.prototype.scrollIntoView = () => {};
});

const live = (model: string, plan?: { enabled: boolean; version: number; planModel?: string | null }) =>
	({
		...emptySessionLive(),
		alive: true,
		state: { model: { provider: "p", id: model }, thinkingLevel: "low" },
		...(plan ? { plan } : {}),
	}) as never;

const setSessions = (sessions: Record<string, unknown>) =>
	act(() => {
		useLive.setState({ sessions: sessions as never });
	});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The toolbar model chip: the only non-menu button whose text is a model id. */
const chip = (): HTMLButtonElement => {
	const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
		(x) => !x.dataset.pick && /model-[abc]/.test(x.textContent ?? ""),
	);
	if (!b) throw new Error("model chip not rendered");
	return b;
};
const chipModel = () => /model-[abc]/.exec(chip().textContent ?? "")?.[0];

const pick = async (id: string) => {
	fireEvent.click(chip());
	fireEvent.click(document.querySelector(`[data-pick="p/model-${id}"]`)!);
	await flush();
};

const sent = (type: string, sid?: string) =>
	h.rpcSend.mock.calls.filter(([id, c]) => (c as { type: string }).type === type && (!sid || id === sid));

const deferred = <T,>() => {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
};

beforeEach(() => {
	clearAllPlanModelApplied();
	localStorage.clear();
	h.rpcSend.mockReset();
	h.rpcSend.mockImplementation(async () => ({}));
	h.rolesRead.mockReset();
	h.rolesRead.mockImplementation(async () => snap());
	h.materialize.mockClear();
	h.rolesSet.mockReset();
	h.rolesSet.mockImplementation(async (_cwd, _scope, _table, _name, value) => snap(String(value)));
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} } as never);
	usePendingSession.setState({ drafts: {}, selectedId: null });
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("Composer plan model chip", () => {
	it("shows the plan model immediately (not the session model) and applies it once", async () => {
		setSessions({ [S1]: live("model-a") });
		render(<Composer sessionId={S1} />);
		expect(chipModel()).toBe("model-a");

		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		// Synchronously after the status frame, before any effect result.
		expect(chipModel()).toBe("model-b");
		expect(chip().textContent).not.toContain("model-a");
		await flush();

		expect(sent("set_model", S1).map(([, c]) => c)).toEqual([{ type: "set_model", provider: "p", modelId: "model-b" }]);
		expect(sent("set_thinking_level", S1).map(([, c]) => c)).toEqual([{ type: "set_thinking_level", level: "high" }]);
		expect(chipModel()).toBe("model-b");
	});

	it("saves a picked model to the global scope, or the project scope when it pins plan", async () => {
		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();

		await pick("c");
		expect(h.rolesSet).toHaveBeenLastCalledWith(null, "global", "modelRoles", "plan", "p/model-c:high", "p/model-a");
		expect(chipModel()).toBe("model-c");
		expect(sent("set_model", S1).map(([, c]) => c)).toEqual([{ type: "set_model", provider: "p", modelId: "model-c" }]);

		h.rolesRead.mockImplementation(async () => snap("p/model-b", "p/model-b"));
		await pick("a");
		expect(h.rolesSet).toHaveBeenLastCalledWith(null, "project", "modelRoles", "plan", "p/model-a:high", expect.anything());
		expect(chipModel()).toBe("model-a");
	});

	it("leaves the chip and session untouched when the save fails", async () => {
		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();
		h.rolesSet.mockRejectedValueOnce(new Error("disk full"));

		await pick("c");
		expect(chipModel()).toBe("model-b");
		expect(sent("set_model")).toHaveLength(0);
	});

	it("restores the session model in the chip when plan mode turns off", async () => {
		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		render(<Composer sessionId={S1} />);
		await flush();
		await pick("c");
		expect(chipModel()).toBe("model-c");

		// The process now runs the applied plan model; leaving plan mode keeps showing the session's.
		setSessions({ [S1]: live("model-c", { enabled: false, version: 0, planModel: "p/model-b:high" }) });
		expect(chipModel()).toBe("model-c");
		setSessions({ [S1]: live("model-a", { enabled: false, version: 0 }) });
		expect(chipModel()).toBe("model-a");
	});

	it("does not write one session's edit into the next plan-enabled session", async () => {
		setSessions({
			[S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
			[S2]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
		});
		const view = render(<Composer sessionId={S1} />);
		await flush();
		await pick("c");
		expect(chipModel()).toBe("model-c");
		h.rpcSend.mockClear();
		h.rolesSet.mockClear();

		view.rerender(<Composer sessionId={S2} />);
		// First render of S2 already shows S2's own plan model.
		expect(chipModel()).toBe("model-b");
		await flush();

		expect(h.rolesSet).not.toHaveBeenCalled();
		expect(sent("set_model", S1)).toHaveLength(0);
		expect(sent("set_model", S2).map(([, c]) => c)).toEqual([{ type: "set_model", provider: "p", modelId: "model-b" }]);
		expect(chipModel()).toBe("model-b");

		await pick("a");
		expect(h.rolesSet).toHaveBeenLastCalledWith(null, "global", "modelRoles", "plan", "p/model-a:high", expect.anything());
		expect(sent("set_model", S1)).toHaveLength(0);
	});

	it("re-selecting a session that already took the plan model does not apply a role edited elsewhere", async () => {
		setSessions({
			[S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
			[S2]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
		});
		const view = render(<Composer sessionId={S1} />);
		await flush();
		expect(sent("set_model", S1)).toHaveLength(1);

		// The shared plan role is edited from another session; S1 is not touched by it.
		setSessions({
			[S1]: live("model-b", { enabled: true, version: 0, planModel: "p/model-c:high" }),
			[S2]: live("model-a", { enabled: true, version: 0, planModel: "p/model-c:high" }),
		});
		await flush();
		view.rerender(<Composer sessionId={S2} />);
		await flush();
		h.rpcSend.mockClear();
		view.rerender(<Composer sessionId={S1} />);
		await flush();
		view.unmount();
		render(<Composer sessionId={S1} />);
		await flush();

		expect(sent("set_model", S1)).toHaveLength(0);
	});

	it("an in-flight auto-apply cannot touch a newly selected session", async () => {
		const gate = deferred<Record<string, unknown>>();
		h.rpcSend.mockImplementation(async (_id, cmd) =>
			(cmd as { type: string }).type === "set_model" ? gate.promise : {},
		);
		setSessions({
			[S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
			[S2]: live("model-a"),
		});
		const view = render(<Composer sessionId={S1} />);
		await flush();
		expect(sent("set_model", S1)).toHaveLength(1); // apply started, parked on set_model

		view.rerender(<Composer sessionId={S2} />);
		gate.resolve({});
		await flush();

		expect(sent("set_thinking_level")).toHaveLength(0);
		expect(sent("set_model", S2)).toHaveLength(0);
		expect(chipModel()).toBe("model-a");
	});

	it("an in-flight auto-apply cannot override a newer user choice", async () => {
		const gate = deferred<Record<string, unknown>>();
		h.rpcSend.mockImplementation(async (_id, cmd) => {
			const c = cmd as { type: string; modelId?: string };
			return c.type === "set_model" && c.modelId === "model-b" ? gate.promise : {};
		});
		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		render(<Composer sessionId={S1} />);
		await flush();

		await pick("c");
		expect(chipModel()).toBe("model-c");
		gate.resolve({});
		await flush();

		expect(sent("set_thinking_level")).toHaveLength(0);
		expect(chipModel()).toBe("model-c");
		const models = sent("set_model", S1).map(([, c]) => (c as { modelId: string }).modelId);
		expect(models[models.length - 1]).toBe("model-c");
	});

	it("a save pending while switching sessions changes neither chip nor sends a stale model", async () => {
		const pending = deferred<ModelRoleSnapshot>();
		setSessions({
			[S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
			[S2]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }),
		});
		const view = render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();
		h.rolesSet.mockImplementationOnce(() => pending.promise);

		await pick("c"); // save started, unresolved
		view.rerender(<Composer sessionId={S2} />);
		await flush();
		h.rpcSend.mockClear();
		pending.resolve(snap("p/model-c:high"));
		await flush();

		expect(chipModel()).toBe("model-b");
		expect(sent("set_model")).toHaveLength(0);
		expect(sent("set_thinking_level")).toHaveLength(0);
	});

	it("a save pending while plan mode turns off sends no stale model", async () => {
		const pending = deferred<ModelRoleSnapshot>();
		setSessions({ [S1]: live("model-a", { enabled: true, version: 0, planModel: "p/model-b:high" }) });
		render(<Composer sessionId={S1} />);
		await flush();
		h.rpcSend.mockClear();
		h.rolesSet.mockImplementationOnce(() => pending.promise);

		await pick("c");
		setSessions({ [S1]: live("model-a", { enabled: false, version: 0 }) });
		pending.resolve(snap("p/model-c:high"));
		await flush();

		expect(chipModel()).toBe("model-a");
		expect(sent("set_model")).toHaveLength(0);
	});
});

const DRAFT = "local-draft:plan-preview";
const PLAN_CHIP = { name: "plan", title: "规划模式", argHint: "<任务>" };

/** The toolbar thinking chip: the button whose whole text is a thinking level. */
const thinkingText = () =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
		.map((b) => b.textContent?.trim() ?? "")
		.find((x) => /^(auto|off|minimal|low|medium|high|xhigh)$/.test(x));

const textarea = (id: string) => {
	const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${id}"]`);
	if (!el) throw new Error("composer textarea not rendered");
	return el;
};

/** Preview never mutates a draft/session; read-only discovery RPCs (get_available_commands) are fine. */
const MUTATING = ["prompt", "set_model", "set_thinking_level"];
const expectNoMutation = () => {
	const mutating = h.rpcSend.mock.calls.filter(([, c]) => MUTATING.includes((c as { type: string }).type));
	expect(mutating).toEqual([]);
};

/** Project pins plan=b:high; the ordinary model is a. Writes mirror the saved scope. */
const projectPinsPlan = () => {
	h.rolesRead.mockImplementation(async () => snap(undefined, "p/model-b:high"));
	h.rolesSet.mockImplementation(async (_cwd, scope, _table, _name, value) =>
		scope === "project" ? snap(undefined, String(value)) : snap(String(value), "p/model-b:high"),
	);
};

describe("Composer plan preview before the command is sent", () => {
	beforeEach(() => {
		projectPinsPlan();
		usePendingSession.setState({
			drafts: {
				[DRAFT]: {
					id: DRAFT, cwd: "/tmp/proj", mode: "code", groupId: null,
					opts: { cwd: "/tmp/proj" } as never, model: "p/model-a", thinking: "low",
					sessionId: null, startError: null,
				},
			},
			selectedId: DRAFT,
		});
		setSessions({ [DRAFT]: { ...emptySessionLive(), alive: true, state: {} } });
	});

	it("shows the project plan model and thinking on a local draft with /plan selected, without sending", async () => {
		render(<Composer sessionId={DRAFT} />);
		expect(chipModel()).toBe("model-a");
		expect(thinkingText()).toBe("low");

		saveChip(DRAFT, PLAN_CHIP);
		cleanup();
		render(<Composer sessionId={DRAFT} />);
		await flush();

		expect(h.rolesRead).toHaveBeenCalledWith("/tmp/proj", expect.anything());
		expect(chipModel()).toBe("model-b");
		expect(thinkingText()).toBe("high");
		expect(h.materialize).not.toHaveBeenCalled();
		expectNoMutation();
		expect(h.rolesSet).not.toHaveBeenCalled();
		expect(useLive.getState().sessions[DRAFT]?.plan).toBeUndefined();
		expect(usePendingSession.getState().drafts[DRAFT]).toMatchObject({ model: "p/model-a", thinking: "low", sessionId: null });
	});

	it("saves a picked model to the project role and previews it; the draft model stays untouched", async () => {
		saveChip(DRAFT, PLAN_CHIP);
		render(<Composer sessionId={DRAFT} />);
		await flush();
		expect(chipModel()).toBe("model-b");

		await pick("c");
		expect(h.rolesSet).toHaveBeenLastCalledWith("/tmp/proj", "project", "modelRoles", "plan", "p/model-c:high", "p/model-a");
		expect(chipModel()).toBe("model-c");
		expect(thinkingText()).toBe("high");
		expect(h.materialize).not.toHaveBeenCalled();
		expectNoMutation();
		expect(usePendingSession.getState().drafts[DRAFT]).toMatchObject({ model: "p/model-a", thinking: "low", sessionId: null });
	});

	it("saves a picked thinking level to the project role while previewing, leaving the draft untouched", async () => {
		usePendingSession.getState().update(DRAFT, { thinking: "high" });
		saveChip(DRAFT, PLAN_CHIP);
		render(<Composer sessionId={DRAFT} />);
		await flush();
		expect(thinkingText()).toBe("high");

		const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
			(b) => b.textContent?.trim() === "high",
		)!;
		fireEvent.click(trigger);
		const option = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
			(b) => b.querySelector(".font-medium")?.textContent === "low",
		)!;
		fireEvent.click(option);
		await flush();

		expect(h.rolesSet).toHaveBeenLastCalledWith("/tmp/proj", "project", "modelRoles", "plan", "p/model-b:low", "p/model-a");
		expect(chipModel()).toBe("model-b");
		expect(thinkingText()).toBe("low");
		expect(h.materialize).not.toHaveBeenCalled();
		expectNoMutation();
		expect(usePendingSession.getState().drafts[DRAFT]).toMatchObject({ model: "p/model-a", thinking: "high", sessionId: null });

		const ta = textarea(DRAFT);
		ta.setSelectionRange(0, 0);
		fireEvent.keyDown(ta, { key: "Backspace" });
		await flush();
		expect(chipModel()).toBe("model-a");
		expect(thinkingText()).toBe("high");
	});

	it("restores the ordinary draft model and thinking when the /plan chip is removed", async () => {
		saveChip(DRAFT, PLAN_CHIP);
		render(<Composer sessionId={DRAFT} />);
		await flush();
		await pick("c");
		expect(chipModel()).toBe("model-c");

		const ta = textarea(DRAFT);
		ta.setSelectionRange(0, 0);
		fireEvent.keyDown(ta, { key: "Backspace" });
		await flush();

		expect(loadChip(DRAFT)).toBeNull();
		expect(chipModel()).toBe("model-a");
		expect(thinkingText()).toBe("low");
		expect(h.materialize).not.toHaveBeenCalled();
		expectNoMutation();
	});

	it("ignores a role read that resolves after the chip was removed", async () => {
		const pending = deferred<ModelRoleSnapshot>();
		h.rolesRead.mockImplementationOnce(() => pending.promise);
		saveChip(DRAFT, PLAN_CHIP);
		render(<Composer sessionId={DRAFT} />);

		const ta = textarea(DRAFT);
		ta.setSelectionRange(0, 0);
		fireEvent.keyDown(ta, { key: "Backspace" });
		pending.resolve(snap(undefined, "p/model-b:high"));
		await flush();

		expect(chipModel()).toBe("model-a");
		expect(thinkingText()).toBe("low");
	});

	it("previews the plan role for a pending /plan on an existing session without applying it", async () => {
		useSessions.setState({ sessions: { [S1]: { id: S1, cwd: "/work/real", model: "p/model-a" } } } as never);
		setSessions({ [S1]: live("model-a") });
		saveChip(S1, PLAN_CHIP);
		render(<Composer sessionId={S1} />);
		await flush();

		expect(h.rolesRead).toHaveBeenCalledWith("/work/real", expect.anything());
		expect(chipModel()).toBe("model-b");
		expect(thinkingText()).toBe("high");
		expect(sent("set_model")).toHaveLength(0);
		expect(sent("set_thinking_level")).toHaveLength(0);

		await pick("c");
		expect(h.rolesSet).toHaveBeenLastCalledWith("/work/real", "project", "modelRoles", "plan", "p/model-c:high", "p/model-a");
		expect(chipModel()).toBe("model-c");
		expect(sent("set_model")).toHaveLength(0);

		const ta = textarea(S1);
		ta.setSelectionRange(0, 0);
		fireEvent.keyDown(ta, { key: "Backspace" });
		await flush();
		expect(chipModel()).toBe("model-a");
		expect(thinkingText()).toBe("low");
		expect(sent("set_model")).toHaveLength(0);
	});
});
