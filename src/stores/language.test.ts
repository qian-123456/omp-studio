// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLanguageStore, useT } from "./language";

describe("language store", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useLanguageStore.setState({ locale: "zh-CN" });
	});

	it("defaults to zh-CN", () => {
		expect(useLanguageStore.getState().locale).toBe("zh-CN");
		expect(useLanguageStore.getState().t("common.confirm")).toBe("确认");
	});

	it("switches locale and translates reactively", () => {
		const { result } = renderHook(() => useT());
		expect(result.current.locale).toBe("zh-CN");
		expect(result.current.t("common.confirm")).toBe("确认");

		act(() => {
			result.current.setLocale("en-US");
		});

		expect(result.current.locale).toBe("en-US");
		expect(result.current.t("common.confirm")).toBe("Confirm");
		expect(window.localStorage.getItem("ompws:locale")).toBe("en-US");
	});

	it("updates state when switched back to zh-CN", () => {
		const { result } = renderHook(() => useT());
		act(() => {
			result.current.setLocale("en-US");
		});
		expect(result.current.locale).toBe("en-US");

		act(() => {
			result.current.setLocale("zh-CN");
		});
		expect(result.current.locale).toBe("zh-CN");
		expect(result.current.t("common.cancel")).toBe("取消");
		expect(window.localStorage.getItem("ompws:locale")).toBe("zh-CN");
	});
});
