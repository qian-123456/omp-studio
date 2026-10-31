// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLoad } from "./hooks";

describe("useLoad", () => {
	it("ignores a superseded response after switching resources", async () => {
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

	it("keeps loaded data on refresh failure and clears the error after recovery", async () => {
		let fail = false;
		const { result } = renderHook(() => useLoad(async () => {
			if (fail) throw new Error("refresh offline");
			return "useful panel contents";
		}, []));
		await waitFor(() => expect(result.current.data).toBe("useful panel contents"));
		fail = true;
		await act(async () => result.current.reload());
		expect(result.current.data).toBe("useful panel contents");
		expect(result.current.error).toBe("refresh offline");
		expect(result.current.loading).toBe(false);
		fail = false;
		await act(async () => result.current.reload());
		expect(result.current.error).toBeNull();
		expect(result.current.data).toBe("useful panel contents");
	});

	it("clears old resource contents and aborts requests on change and unmount", async () => {
		const signals: AbortSignal[] = [];
		const resolvers: Record<string, (value: string) => void> = {};
		const { result, rerender, unmount } = renderHook(({ id }) => useLoad((signal) => {
			signals.push(signal);
			// ES2021 target does not expose Promise.withResolvers.
			return new Promise<string>((resolve) => { resolvers[id] = resolve; });
		}, [id]), { initialProps: { id: "first" } });
		await act(async () => resolvers.first("first contents"));
		expect(result.current.data).toBe("first contents");
		rerender({ id: "second" });
		expect(signals[0].aborted).toBe(true);
		expect(result.current.data).toBeNull();
		expect(result.current.loading).toBe(true);
		unmount();
		expect(signals[1].aborted).toBe(true);
		await act(async () => resolvers.second("late unmounted result"));
	});
});
