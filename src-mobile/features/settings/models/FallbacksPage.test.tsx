// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as apiModule from "../../../core/api";
import { SettingsFallbacksPage } from "./FallbacksPage";

afterEach(() => { cleanup();vi.restoreAllMocks(); });
it("reorders a fallback chain locally, restores it, then confirms persistence in the visible order", async () => {
 const api=vi.spyOn(apiModule,"api").mockImplementation(async (_method,path)=>path==="/left/fallbacks"?{global:{default:["fixture/first","fixture/second"]}}:path==="/left/roles"?{models:[]}:{omp:{}});
 render(<SettingsFallbacksPage route={{name:"settingsFallbacks",path:"/settings/fallbacks",params:{},query:{}}}/>);
 await screen.findByText("fixture/first");
 fireEvent.click(screen.getAllByRole("button",{name:"下移"})[0]);
 expect(screen.getByText("fixture/second").compareDocumentPosition(screen.getByText("fixture/first"))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(api.mock.calls.filter(([method])=>method==="POST")).toHaveLength(0);
 fireEvent.click(screen.getByRole("button",{name:"还原"}));
 expect(screen.getByText("fixture/first").compareDocumentPosition(screen.getByText("fixture/second"))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(screen.getAllByRole("button",{name:"下移"})[0]);fireEvent.click(screen.getByRole("button",{name:"保存"}));
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"确认保存"})));
 expect(api).toHaveBeenCalledWith("POST","/left/fallbacks/set",{chains:{default:["fixture/second","fixture/first"]}});
});
