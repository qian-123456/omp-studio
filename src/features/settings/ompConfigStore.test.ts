import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmpConfigEntry } from "../../lib/contracts";

const ompConfigList = vi.fn();
vi.mock("../../lib/ipc", () => ({ ompConfigList: (k: string) => ompConfigList(k) }));

import { useOmpConfigStore } from "./ompConfigStore";

function entry(key: string, tab: string): OmpConfigEntry {
	return {
		key,
		value: null,
		valueType: "string",
		description: "",
		redacted: false,
		tab,
	};
}

beforeEach(() => {
	ompConfigList.mockReset();
	useOmpConfigStore.setState({
		entries: [],
		loading: false,
		loaded: false,
		error: null,
	});
});

describe("ompConfigStore", () => {
	it("fetches once and caches across load() calls", async () => {
		ompConfigList.mockResolvedValue({
			found: true,
			entries: [entry("model.temperature", "model")],
			error: null,
		});
		await useOmpConfigStore.getState().load();
		await useOmpConfigStore.getState().load();
		expect(ompConfigList).toHaveBeenCalledTimes(1);
		expect(useOmpConfigStore.getState().entries).toHaveLength(1);
		expect(useOmpConfigStore.getState().loaded).toBe(true);
	});

	it("force reloads and refreshes entries", async () => {
		ompConfigList.mockResolvedValue({
			found: true,
			entries: [entry("a", "internal")],
			error: null,
		});
		await useOmpConfigStore.getState().load();
		ompConfigList.mockResolvedValue({
			found: true,
			entries: [entry("a", "internal"), entry("b", "model")],
			error: null,
		});
		await useOmpConfigStore.getState().load(true);
		expect(ompConfigList).toHaveBeenCalledTimes(2);
		expect(useOmpConfigStore.getState().entries).toHaveLength(2);
	});

	it("surfaces a readable error when omp is missing", async () => {
		ompConfigList.mockResolvedValue({
			found: false,
			entries: [],
			error: "未找到 OMP 命令行程序",
		});
		await useOmpConfigStore.getState().load();
		expect(useOmpConfigStore.getState().loaded).toBe(false);
		expect(useOmpConfigStore.getState().error).toBe("未找到 OMP 命令行程序");
	});
});
