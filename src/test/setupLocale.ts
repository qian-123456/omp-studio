import { beforeEach } from "vitest";
import { useLanguageStore } from "../stores/language";


if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
}
// jsdom reports navigator.language "en-US", which would flip the UI to English;
// tests assert the default (zh-CN) copy unless they switch locale themselves.
beforeEach(() => {
	useLanguageStore.setState({ locale: "zh-CN" });
});
