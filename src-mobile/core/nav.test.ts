// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetNavForTests, initNav, nav, parseRoute, paths } from "./nav";

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("parseRoute", () => {
	it("matches every contract route", () => {
		const cases: Array<[string, string, Record<string, string>?]> = [
			["/", "home"],
			["/s/abc", "chat", { id: "abc" }],
			["/s/abc/subagents", "subagents", { id: "abc" }],
			["/s/abc/subagents/a1", "subagent", { id: "abc", agentId: "a1" }],
			["/s/abc/files", "files"],
			["/s/abc/git", "git"],
			["/s/abc/terminal", "terminal"],
			["/s/abc/plan", "plan"],
			["/s/abc/sidechat", "sidechat"],
			["/s/abc/services", "services"],
			["/inbox", "inbox"],
			["/search", "search"],
			["/schedules", "schedules"],
			["/schedules/new", "scheduleNew"],
			["/schedules/x1", "schedule", { id: "x1" }],
			["/schedules/x1/runs", "scheduleRuns", { id: "x1" }],
			["/skills", "skills"],
			["/ideas", "ideas"],
			["/settings", "settings"],
			["/settings/roles", "settingsRoles"],
			["/settings/providers", "settingsProviders"],
			["/settings/fallbacks", "settingsFallbacks"],
			["/settings/context", "settingsContext"],
			["/quota", "quota"],
		];
		for (const [path, name, params] of cases) {
			const r = parseRoute(`#${path}`);
			expect(r.name, path).toBe(name);
			if (params) expect(r.params).toMatchObject(params);
		}
	});

	it("decodes ids, reads the query, tolerates trailing slashes and flags unknown paths", () => {
		expect(parseRoute("#/s/mobile-draft-1%2F2").params.id).toBe("mobile-draft-1/2");
		expect(parseRoute("#/s/a/files/?x=1&y=2").query).toEqual({ x: "1", y: "2" });
		expect(parseRoute("#/s/a/files/").name).toBe("files");
		expect(parseRoute("").name).toBe("home");
		expect(parseRoute("#/nope/zzz").name).toBe("notFound");
		expect(parseRoute("#/s/%E0%A4%A").params.id).toBe("%E0%A4%A");
	});

	it("path builders round-trip through the parser", () => {
		const id = "weird id/with#chars";
		expect(parseRoute(paths.chat(id)).params.id).toBe(id);
		expect(parseRoute(paths.subagent(id, "a b")).params).toMatchObject({ id, agentId: "a b" });
	});
});

describe("nav stack", () => {
	beforeEach(() => {
		__resetNavForTests();
		history.replaceState(null, "", "/");
	});
	afterEach(() => __resetNavForTests());

	it("a legacy deep link gets home underneath so back lands on home", async () => {
		history.replaceState(null, "", "/#/s/abc");
		initNav();
		expect(nav.getRoute()).toMatchObject({ name: "chat", params: { id: "abc" } });
		expect(nav.depth()).toBe(1);
		nav.back();
		await settle();
		expect(nav.getRoute().name).toBe("home");
		expect(location.hash).toBe("#/");
	});

	it("push/back behaves like a stack and replace does not grow it", async () => {
		initNav();
		nav.push("/s/a");
		nav.push("/s/a/files");
		expect(nav.depth()).toBe(2);
		nav.replace("/s/a/git");
		expect(nav.depth()).toBe(2);
		expect(nav.getRoute().name).toBe("git");
		nav.back();
		await settle();
		expect(nav.getRoute().name).toBe("chat");
		nav.back();
		await settle();
		expect(nav.getRoute().name).toBe("home");
		nav.back(); // root: stays in-app
		await settle();
		expect(nav.getRoute().name).toBe("home");
	});

	it("push of the current location does nothing", () => {
		initNav();
		nav.push("/inbox");
		nav.push("/inbox");
		expect(nav.depth()).toBe(1);
	});

	it("home() unwinds the whole stack", async () => {
		initNav();
		nav.push("/s/a");
		nav.push("/s/a/files");
		nav.home();
		await settle();
		expect(nav.getRoute().name).toBe("home");
		expect(nav.depth()).toBe(0);
	});

	it("an overlay layer swallows the back gesture, and closing it by UI pops its entry", async () => {
		initNav();
		nav.push("/s/a");
		const close = vi.fn();
		const dispose = nav.pushLayer(close);
		expect(nav.depth()).toBe(2);
		history.back(); // the user's back gesture
		await settle();
		expect(close).toHaveBeenCalledTimes(1);
		expect(nav.getRoute().name).toBe("chat");
		expect(nav.depth()).toBe(1);
		dispose(); // already closed: no extra history movement
		await settle();
		expect(nav.depth()).toBe(1);

		const close2 = vi.fn();
		const dispose2 = nav.pushLayer(close2);
		dispose2(); // closed through its own button
		await settle();
		expect(close2).not.toHaveBeenCalled();
		expect(nav.depth()).toBe(1);
		expect(nav.getRoute().name).toBe("chat");
	});

	it("navigating while an overlay is open closes it and lands on the target without extra entries", async () => {
		initNav();
		nav.push("/s/a");
		const close = vi.fn();
		const dispose = nav.pushLayer(close);
		nav.push("/s/a/files");
		await settle();
		expect(close).toHaveBeenCalledTimes(1);
		expect(nav.getRoute().name).toBe("files");
		expect(nav.depth()).toBe(2);
		dispose();
		await settle();
		expect(nav.depth()).toBe(2);
		nav.back();
		await settle();
		expect(nav.getRoute().name).toBe("chat");
	});

	it("adopts a plain hash link as one more stack entry", async () => {
		initNav();
		location.hash = "#/search";
		await settle();
		expect(nav.getRoute().name).toBe("search");
		expect(nav.depth()).toBe(1);
	});
});
