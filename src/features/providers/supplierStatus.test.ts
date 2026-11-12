import { describe, expect, it } from "vitest";
import type { ProviderRow, ProviderKeyKind } from "../../lib/contracts";
import { serviceCapability } from "./serviceCapabilities";
import { supplierStatus } from "./supplierStatus";
const capability = { supplier: "openai", method: "key" } as const;
const row = (kind: ProviderKeyKind, overrides: Partial<ProviderRow> = {}): ProviderRow => ({ id: "openai", displayName: null, slug: "openai", origin: "builtin", sources: [], baseUrl: null, api: null, models: [], key: { kind, envVar: null, envSet: null }, enabled: true, testable: false, defaultBaseUrl: null, extraModels: [], authNone: false, ...overrides });
describe("supplier credential evidence", () => {
	it.each(["google-antigravity", "openai-codex", "google-gemini-cli"])("requires account login for missing %s credentials", (supplier) => {
		const service = serviceCapability({ selector: `${supplier}/image`, provider: supplier, kind: "image" });
		expect(supplierStatus(service, undefined, true, null)).toMatchObject({ label: "supplierNotLoggedIn", action: "account", actionLabel: "supplierLogin" });
		expect(supplierStatus(service, row("oauth", { id: supplier }), true, null)).toMatchObject({ label: "supplierLoggedIn", action: "account", actionLabel: "supplierManageAccount" });
	});
	it("does not claim SearXNG authentication is unnecessary or configured", () => {
		expect(supplierStatus(serviceCapability({ selector: "web/searxng", provider: "web", kind: "search" }), undefined, true, null)).toMatchObject({ label: "supplierParameters", action: "settings" });
	});
	it.each(["plaintext", "loginStored"] as const)("reuses stored %s evidence without asserting validity", (kind) => {
		expect(supplierStatus(capability, row(kind), true, null)).toMatchObject({ label: "supplierKeyAdded", action: "key", reuse: "key" });
	});
	it("routes existing OAuth to account management", () => {
		expect(supplierStatus(capability, row("oauth"), true, null)).toMatchObject({ label: "supplierLoggedIn", action: "account", actionLabel: "supplierManageAccount" });
	});
	it("distinguishes loading, read errors, and missing storage", () => {
		expect(supplierStatus(capability, undefined, false, null)).toMatchObject({ label: "supplierLoading", action: null });
		expect(supplierStatus(capability, row("plaintext"), true, "offline")).toMatchObject({ label: "supplierUnknown", action: null });
		expect(supplierStatus(capability, undefined, true, null)).toMatchObject({ label: "supplierKeyMissing", actionLabel: "supplierAddKey" });
	});
	it("qualifies environment and command sources", () => {
		expect(supplierStatus(capability, row("envVar", { key: { kind: "envVar", envVar: "KEY", envSet: false } }), true, null)).toMatchObject({ label: "supplierEnvUnset", warning: true, action: "key" });
		expect(supplierStatus(capability, row("envVar", { key: { kind: "envVar", envVar: "KEY", envSet: true } }), true, null).label).toBe("supplierEnvSet");
		expect(supplierStatus(capability, row("envVar"), true, null).label).toBe("supplierUnknown");
		expect(supplierStatus(capability, row("command"), true, null).label).toBe("supplierCommand");
	});
	it("does not interpret disabled credentials as invalid", () => {
		expect(supplierStatus(capability, row("oauth", { enabled: false }), true, null)).toMatchObject({ label: "supplierDisabled", action: "account", warning: false });
	});
	it("separates keyless Google search from keyed Gemini and optional MCP keys", () => {
		const search = serviceCapability({ selector: "web/google", provider: "web", kind: "search" });
		expect(search.supplier).toBe("web/google");
		expect(supplierStatus(search, undefined, true, null)).toMatchObject({ label: "supplierKeyless", action: null });
		expect(supplierStatus(serviceCapability({ selector: "google/gemini", provider: "google", kind: "image" }), undefined, true, null).label).toBe("supplierKeyMissing");
		expect(supplierStatus(serviceCapability({ selector: "web/exa", provider: "web", kind: "search" }), undefined, true, null).label).toBe("supplierOptionalKey");
	});
	it("keeps local parameters and unsupported advanced configuration at supplier level", () => {
		expect(supplierStatus(serviceCapability({ selector: "local/speech", provider: "local", kind: "tts" }), undefined, true, null)).toMatchObject({ label: "supplierKeyless", action: "settings" });
		expect(supplierStatus({ supplier: "future", method: "advanced" }, undefined, true, null)).toMatchObject({ label: "supplierAdvanced", action: "advanced" });
		expect(supplierStatus({ supplier: "kimi", method: "advanced" }, undefined, true, null)).toMatchObject({ label: "supplierNotLoggedIn", action: "account" });
	});
});
