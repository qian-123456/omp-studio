// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../../core/api";
import { ToastHost } from "../../../ui/Toast";
import { SettingsRolesPage } from "./RolesPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("role inverse persistence", () => {
 it.each([null, "/fixture/project"])("saves a single model edit directly and restores exact scope %s", async (cwd) => {
  const global: Record<string, string> = { default: "fixture/first:low" };
  const project: Record<string, string> = {};
  const request = vi.spyOn(apiModule, "api").mockImplementation(async (method, _path, body) => {
   if (method === "POST") {
    if (!body || typeof body !== "object" || !("scope" in body) || !("name" in body) || !("value" in body) || typeof body.name !== "string") throw new Error("Invalid role request");
    const target = body.scope === "project" ? project : global;
    if (body.value === null) delete target[body.name]; else if (typeof body.value === "string") target[body.name] = body.value;
    return {};
   }
   return { snapshot: { global: { modelRoles: { ...global } }, project: { modelRoles: { ...project } } }, models: [{ provider: "fixture", id: "first", name: "First", thinking: ["low", "high"] }, { provider: "fixture", id: "second", name: "Second", thinking: ["low", "high"] }] };
  });
  render(<><SettingsRolesPage route={{ name: "settingsRoles", path: "/settings/roles", params: {}, query: cwd ? { cwd } : {} }} /><ToastHost /></>);
  fireEvent.click(await screen.findByRole("button", { name: /全局默认（主力模型）/ }));
  fireEvent.click(await screen.findByRole("option", { name: /Second/ }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "保存" })));
  const target = cwd ? project : global;
  expect(target.default).toBe("fixture/second:low");
  expect(screen.queryByRole("button", { name: "确认保存" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "撤销" })));
  expect(target.default).toBe(cwd ? undefined : "fixture/first:low");
  expect(global.default).toBe("fixture/first:low");
  expect(request).toHaveBeenCalledWith("POST", "/left/roles/set", { cwd, scope: cwd ? "project" : "global", table: "roles", name: "default", value: cwd ? null : "fixture/first:low" });
 });
});
it.each(["compound", "inherit"])("requires explicit confirmation before %s role changes", async (kind) => {
 const request=vi.spyOn(apiModule,"api").mockResolvedValue({snapshot:{global:{modelRoles:{default:"fixture/first:low"}},project:{modelRoles:{default:"fixture/first:low"}}},models:[{provider:"fixture",id:"first",name:"First",thinking:["low","high"]},{provider:"fixture",id:"second",name:"Second",thinking:["low","high"]}]});
 render(<SettingsRolesPage route={{name:"settingsRoles",path:"/settings/roles",params:{},query:{cwd:"/confirm/project"}}}/>);
 fireEvent.click(await screen.findByRole("button",{name:/全局默认（主力模型）/}));
 if(kind==="inherit")fireEvent.click(screen.getByRole("button",{name:"恢复继承"}));
 else{fireEvent.click(await screen.findByRole("option",{name:/Second/}));fireEvent.click(screen.getByRole("radio",{name:"高"}));fireEvent.click(screen.getByRole("button",{name:"保存"}));}
 expect(request.mock.calls.filter(([method])=>method==="POST")).toHaveLength(0);
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"确认保存"})));
 expect(request).toHaveBeenCalledWith("POST","/left/roles/set",{cwd:"/confirm/project",scope:"project",table:"roles",name:"default",value:kind==="inherit"?null:"fixture/second:high"});
});
