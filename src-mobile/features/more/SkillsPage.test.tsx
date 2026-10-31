// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import { SkillsPage } from "./SkillsPage";

vi.mock("../../core/nav", () => ({ nav: { back: vi.fn(), pushLayer: () => () => {} } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("real skill catalog UI", () => {
 it("opens server-provided content without toggling, and persists the independent enable switch", async () => {
  let enabled = true;
  const skill = { name: "fixture-skill", description: "Server supplied skill", source: "user", provider: "claude", path: "/fixture/SKILL.md", dir: "/fixture", root: "/fixture", copies: 1, issues: [], promptChars: 120, enabled: true, disabledReason: null };
  const request = vi.spyOn(apiModule, "api").mockImplementation(async (method, path, body) => {
   if (method === "POST") {
    if (!body || typeof body !== "object" || !("enabled" in body) || typeof body.enabled !== "boolean") throw new Error("Invalid skill toggle fixture request");
    enabled = body.enabled; return {};
   }
   if (path.startsWith("/left/skills/content")) return { text: "---\nname: fixture-skill\n---\n# Actual server body" };
   return { skills: [{ ...skill, enabled }], extensions: [], skillsEnabled: true };
  });
  render(<SkillsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /fixture-skill.*claude.*Server supplied skill/ }));
  expect(await screen.findByRole("heading", { name: "Actual server body" })).toBeTruthy();
  expect(request).toHaveBeenCalledWith("GET", "/left/skills/content?path=%2Ffixture%2FSKILL.md");
  expect(request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(0);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("user")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("switch", { name: "启用 fixture-skill" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("POST", "/left/skills/toggle", { name: "fixture-skill", enabled: false }));
  await waitFor(() => expect(within(dialog).getByRole("switch", { name: "启用 fixture-skill" }).getAttribute("aria-checked")).toBe("false"));
 });
});
