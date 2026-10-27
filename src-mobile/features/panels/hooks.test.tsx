// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLoad } from "./hooks";

describe("useLoad", () => {
	it("ignores a superseded response and surfaces errors without stale data", async () => {
		const resolvers: Record<string, (v: string) => void> = {};
		const fn = (key: string) => () => new Promise<string>((r) => {
			resolvers[key] = r;
		});
		const { result, rerender } = renderHook(({ k }) => useLoad(fn(k), [k]), { initialProps: { k: "a" } });
		rerender({ k: "b" });
		await act(async () => {
			resolvers.b("B");
			resolvers.a("A");
		});
		await waitFor(() => expect(result.current.data).toBe("B"));
	});
	it("reports a failure and recovers on reload", async () => {
		let fail = true;
		const { result } = renderHook(() =>
			useLoad(async () => {
				if (fail) throw new Error("boom");
				return "ok";
			}, []),
		);
		await waitFor(() => expect(result.current.error).toBe("boom"));
		expect(result.current.data).toBeNull();
		fail = false;
		await act(async () => {
			await result.current.reload();
		});
		expect(result.current.data).toBe("ok");
		expect(result.current.error).toBeNull();
	});
});
