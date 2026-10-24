// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLanguageStore } from "../../../stores/language";
import { AppearanceSection } from "./AppearanceSection";

beforeEach(() => {
	window.localStorage.clear();
	useLanguageStore.setState({ locale: "zh-CN" });
});
afterEach(cleanup);

describe("AppearanceSection language selection", () => {
	it("renders language segmented control with current locale", () => {
		render(<AppearanceSection />);
		const langRow = screen.getByText("界面语言");
		expect(langRow).toBeDefined();

		const enOption = screen.getByText("English");
		expect(enOption).toBeDefined();

		fireEvent.click(enOption);

		expect(useLanguageStore.getState().locale).toBe("en-US");
		expect(window.localStorage.getItem("ompws:locale")).toBe("en-US");
	});
});
