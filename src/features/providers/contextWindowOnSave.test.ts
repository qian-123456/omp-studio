import { expect, it } from "vitest";
import { planContextWindows } from "./contextWindowOnSave";
import { isExplicitServiceModel, SERVICE_PURPOSES, serviceApiSupportsKind } from "./presets";
it("never auto-fills non-chat rows in a mixed provider", () => {
 const result = planContextWindows(null, { models: [
  { id: "image-model", kind: "image", api: "openai-images" },
  { id: "voice-model", api: "openai-speech" },
  { id: "chat-model" },
 ] }, [{ id: "rule", keywords: ["model"], contextWindow: 12345, createdAt: 1 }], []);
 expect(result.fills.has("image-model")).toBe(false);
 expect(result.fills.has("voice-model")).toBe(false);
 expect(result.fills.get("chat-model")).toBe(12345);
 expect(isExplicitServiceModel({ api: "openai-responses" })).toBe(false);
});
it("offers only upstream declarable service protocols and detects incompatible pairs", () => {
 expect(SERVICE_PURPOSES.flatMap((p) => [...p.apis])).not.toContain("web-search");
 expect(SERVICE_PURPOSES.flatMap((p) => [...p.apis])).not.toContain("local-inference");
 expect(SERVICE_PURPOSES.flatMap((p) => [...p.apis])).not.toContain("workers-ai-systemone");
 expect(SERVICE_PURPOSES.flatMap((p) => [...p.apis])).not.toContain("openai-codex-responses");
 expect(SERVICE_PURPOSES.flatMap((p) => [...p.apis])).not.toContain("google-gemini-cli");
 expect(serviceApiSupportsKind("judge", "workers-ai-systemone")).toBe(true);
 expect(serviceApiSupportsKind("judge", "openai-completions")).toBe(false);
 expect(serviceApiSupportsKind("image", "openai-speech")).toBe(false);
 expect(serviceApiSupportsKind("image", "openai-images")).toBe(true);
 expect(serviceApiSupportsKind("image", "openai-responses")).toBe(true);
 expect(SERVICE_PURPOSES.every((p) => p.apis.length > 0)).toBe(true);
 expect(serviceApiSupportsKind("unknown", "custom-api")).toBeNull();
});
