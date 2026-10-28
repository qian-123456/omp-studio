import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionItem, SkillItem } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { DEFAULT_SKILL_CONFIG } from "../../lib/skillEnablement";
import { toast } from "../../lib/toast";
import { updateOmpListSetting } from "./ompListSetting";
import { useSkillsStore } from "./store";

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("../settings/ompConfigStore", () => ({
	useOmpConfigStore: { getState: () => ({ invalidate }) },
}));
vi.mock("../../lib/toast", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../lib/ipc", () => ({
	skillsList: vi.fn(),
	skillsUsage: vi.fn(),
	skillsTrash: vi.fn(),
	ompConfigList: vi.fn(),
	ompProjectConfigRead: vi.fn(),
	ompConfigSet: vi.fn(),
	extensionEnableFile: vi.fn(),
}));

const target: SkillItem = {
	name: "new-one",
	description: "",
	source: "user",
	path: "/home/.omp/agent/skills/new-one/SKILL.md",
	dir: "/home/.omp/agent/skills/new-one",
	root: "~/.omp/agent/skills",
	provider: "native",
	copies: 1,
	issues: [],
	promptChars: 10,
};
const extension: ExtensionItem = {
	name: "ext-a",
	path: "/home/.omp/agent/extensions/ext-a.ts.disabled",
	source: "user",
	enabled: false,
};
const configList = (disabled: string[]) => ({
	found: true,
	error: null,
	entries: [{
		key: "disabledExtensions",
		value: disabled,
		valueType: "array",
		description: "",
		redacted: false,
		tab: "",
	}],
});
function deferred() {
	let resolve!: () => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

beforeEach(() => {
	vi.resetAllMocks();
	useSkillsStore.setState({
		catalog: { skills: [target], extensions: [extension] },
		skillConfig: { ...DEFAULT_SKILL_CONFIG, disabledExtensions: ["ext-a", "keep"] },
		skillConfigOverrides: [],
		projectConfigPath: null,
		projectConfigNotice: null,
		loading: false,
		error: null,
		drawer: null,
		lastLoadedCwd: undefined,
	});
	vi.mocked(ipc.ompConfigSet).mockResolvedValue(undefined);
	vi.mocked(ipc.extensionEnableFile).mockResolvedValue(undefined);
});

describe("79 OmpListReadModifyWrite", () => {
	it.each(["config command failed", null])("does not write after found=false (%s)", async (error) => {
		const previous = useSkillsStore.getState().skillConfig;
		vi.mocked(ipc.ompConfigList).mockResolvedValue({ found: false, error, entries: [] });

		await useSkillsStore.getState().setSkillEnabled(target, false);

		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
		expect(useSkillsStore.getState().skillConfig).toEqual(previous);
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("does not write after a rejected read", async () => {
		const previous = useSkillsStore.getState().skillConfig;
		vi.mocked(ipc.ompConfigList).mockRejectedValue(new Error("read rejected"));

		await useSkillsStore.getState().setSkillEnabled(target, false);

		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
		expect(useSkillsStore.getState().skillConfig).toEqual(previous);
		expect(toast.error).toHaveBeenCalledTimes(1);
	});

	it("never invokes the mutation or follow-up after an unsuccessful read", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue({ found: false, error: "unreadable", entries: [] });
		const mutate = vi.fn((current: string[]) => [...current, "plugin"]);
		const followUp = vi.fn().mockResolvedValue(undefined);

		await expect(updateOmpListSetting("disabledExtensions", mutate, followUp)).rejects.toThrow("unreadable");

		expect(mutate).not.toHaveBeenCalled();
		expect(followUp).not.toHaveBeenCalled();
		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
	});

	it("serializes skill and shared plugin-list writes without dropping either entry", async () => {
		let persisted = ["keep"];
		const writing = deferred();
		const release = deferred();
		vi.mocked(ipc.ompConfigList).mockImplementation(async () => configList(persisted));
		vi.mocked(ipc.ompConfigSet).mockImplementationOnce(async (_key, value) => {
			writing.resolve();
			await release.promise;
			persisted = JSON.parse(value);
		}).mockImplementation(async (_key, value) => { persisted = JSON.parse(value); });

		const skillWrite = useSkillsStore.getState().setSkillEnabled(target, false);
		await writing.promise;
		const pluginWrite = updateOmpListSetting("disabledExtensions", (current) => [...current, "plugin"]);
		expect(ipc.ompConfigList).toHaveBeenCalledTimes(1);
		release.resolve();
		await Promise.all([skillWrite, pluginWrite]);

		expect(persisted).toEqual(["keep", "skill:new-one", "plugin"]);
		expect(toast.success).toHaveBeenCalledTimes(1);
	});

	it("allows a later successful write after a failed read", async () => {
		vi.mocked(ipc.ompConfigList)
			.mockResolvedValueOnce({ found: false, error: "read failed", entries: [] })
			.mockResolvedValueOnce(configList(["keep"]));

		await useSkillsStore.getState().setSkillEnabled(target, false);
		await useSkillsStore.getState().setSkillEnabled(target, false);

		expect(ipc.ompConfigSet).toHaveBeenCalledTimes(1);
		expect(ipc.ompConfigSet).toHaveBeenCalledWith("disabledExtensions", '["keep","skill:new-one"]');
		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toContain("skill:new-one");
	});

	it("preserves the no-op contract for an unchanged list", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(configList(["keep"]));
		await updateOmpListSetting("disabledExtensions", (current) => current);
		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
	});

	it("allows writes when the key is absent from a successfully read config", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue({ found: true, error: null, entries: [] });

		await useSkillsStore.getState().setSkillEnabled(target, false);

		expect(ipc.ompConfigSet).toHaveBeenCalledWith("disabledExtensions", '["skill:new-one"]');
		expect(toast.success).toHaveBeenCalledTimes(1);
	});
});

describe("80 ExtensionEnableRollback", () => {
	it("does not rename or write when reading config fails", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue({ found: false, error: "unreadable", entries: [] });

		await useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");

		expect(ipc.ompConfigSet).not.toHaveBeenCalled();
		expect(ipc.extensionEnableFile).not.toHaveBeenCalled();
		expect(useSkillsStore.getState().catalog?.extensions[0].enabled).toBe(false);
	});

	it("does not rename when the config write fails", async () => {
		vi.mocked(ipc.ompConfigList).mockResolvedValue(configList(["ext-a", "keep"]));
		vi.mocked(ipc.ompConfigSet).mockRejectedValue(new Error("write failed"));

		await useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");

		expect(ipc.extensionEnableFile).not.toHaveBeenCalled();
		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toEqual(["ext-a", "keep"]);
		expect(useSkillsStore.getState().catalog?.extensions[0].enabled).toBe(false);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("restores the persisted snapshot, not stale UI config, after rename failure", async () => {
		const original = ["ext-a", "extension-module:ext-a", extension.path, "disk-only"];
		let persisted = original;
		vi.mocked(ipc.ompConfigList).mockImplementation(async () => configList(persisted));
		vi.mocked(ipc.ompConfigSet).mockImplementation(async (_key, value) => { persisted = JSON.parse(value); });
		vi.mocked(ipc.extensionEnableFile).mockRejectedValue(new Error("rename failed"));

		await useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");

		expect(ipc.ompConfigSet).toHaveBeenNthCalledWith(1, "disabledExtensions", '["disk-only"]');
		expect(ipc.ompConfigSet).toHaveBeenNthCalledWith(2, "disabledExtensions", JSON.stringify(original));
		expect(persisted).toEqual(original);
		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toEqual(["ext-a", "keep"]);
		expect(useSkillsStore.getState().catalog?.extensions[0].enabled).toBe(false);
		expect(ipc.skillsList).not.toHaveBeenCalled();
		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("finishes rollback before another shared-list writer can run", async () => {
		let persisted = ["ext-a", "keep"];
		const renaming = deferred();
		const release = deferred();
		vi.mocked(ipc.ompConfigList).mockImplementation(async () => configList(persisted));
		vi.mocked(ipc.ompConfigSet).mockImplementation(async (_key, value) => { persisted = JSON.parse(value); });
		vi.mocked(ipc.extensionEnableFile).mockImplementation(async () => {
			renaming.resolve();
			await release.promise;
			throw new Error("rename failed");
		});

		const enable = useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");
		await renaming.promise;
		const pluginWrite = updateOmpListSetting("disabledExtensions", (current) => [...current, "plugin"]);
		expect(ipc.ompConfigList).toHaveBeenCalledTimes(1);
		release.resolve();
		await Promise.all([enable, pluginWrite]);

		expect(persisted).toEqual(["ext-a", "keep", "plugin"]);
		expect(ipc.ompConfigSet).toHaveBeenCalledTimes(3);
	});

	it("reports both failures and reloads actual state if compensation fails", async () => {
		let persisted = ["ext-a", "disk-only"];
		vi.mocked(ipc.ompConfigList).mockImplementation(async () => configList(persisted));
		vi.mocked(ipc.ompConfigSet)
			.mockImplementationOnce(async (_key, value) => { persisted = JSON.parse(value); })
			.mockRejectedValueOnce(new Error("restore failed"));
		vi.mocked(ipc.extensionEnableFile).mockRejectedValue(new Error("rename failed"));
		vi.mocked(ipc.skillsList).mockResolvedValue({ skills: [target], extensions: [extension] });
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue({ path: "/project/.omp/config.yml", exists: false, content: "" });

		await useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");

		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("rename failed"));
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("restore failed"));
		expect(ipc.skillsList).toHaveBeenCalledWith("/project");
		expect(persisted).toEqual(["disk-only"]);
		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toEqual(["disk-only"]);
		expect(useSkillsStore.getState().catalog?.extensions).toEqual([extension]);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("commits the renamed extension and refreshed config on success", async () => {
		let persisted = ["ext-a", "extension-module:ext-a", extension.path, "keep"];
		const enabled = { ...extension, path: extension.path.replace(/\.disabled$/, ""), enabled: true };
		vi.mocked(ipc.ompConfigList).mockImplementation(async () => configList(persisted));
		vi.mocked(ipc.ompConfigSet).mockImplementation(async (_key, value) => { persisted = JSON.parse(value); });
		vi.mocked(ipc.skillsList).mockResolvedValue({ skills: [target], extensions: [enabled] });
		vi.mocked(ipc.ompProjectConfigRead).mockResolvedValue({ path: "/project/.omp/config.yml", exists: false, content: "" });

		await useSkillsStore.getState().setExtensionEnabled(extension, true, "/project");

		expect(persisted).toEqual(["keep"]);
		expect(ipc.ompConfigSet).toHaveBeenCalledTimes(1);
		expect(ipc.extensionEnableFile).toHaveBeenCalledWith(extension.path, "/project");
		expect(useSkillsStore.getState().catalog?.extensions).toEqual([enabled]);
		expect(useSkillsStore.getState().skillConfig.disabledExtensions).toEqual(["keep"]);
		expect(toast.success).toHaveBeenCalledTimes(1);
		expect(toast.error).not.toHaveBeenCalled();
	});
});
