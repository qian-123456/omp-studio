import { beforeEach } from "vitest";
import { useLanguageStore } from "../stores/language";

// jsdom reports navigator.language "en-US", which would flip the UI to English;
// tests assert the default (zh-CN) copy unless they switch locale themselves.
beforeEach(() => {
	useLanguageStore.setState({ locale: "zh-CN" });
});
