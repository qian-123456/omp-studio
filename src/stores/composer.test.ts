const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;

import { beforeEach, describe, expect, it } from "vitest";
import { type Annotation, formatWithAnnotations, sideChatAnnKey, useComposer } from "./composer";

function ann(partial: Omit<Annotation, "id">): Annotation {
	return { ...partial, id: "x" };
}

describe("formatWithAnnotations", () => {
	it("returns the text unchanged when there are no annotations", () => {
		expect(formatWithAnnotations("你好", [])).toBe("你好");
	});

	it("appends numbered quote blocks", () => {
		const out = formatWithAnnotations("看看这个", [
			ann({ source: "message", text: "第一行\n第二行" }),
			ann({ source: "terminal", text: "cmd output" }),
		]);
		expect(out).toContain("看看这个");
		expect(out).toContain("[1]");
		expect(out).toContain("> 第一行");
		expect(out).toContain("> 第二行");
		expect(out).toContain("[2]");
		expect(out).toContain("> cmd output");
		expect(out.indexOf("[1]")).toBeLessThan(out.indexOf("[2]"));
		expect(out.indexOf("[2]")).toBeLessThan(out.indexOf("看看这个"));
		expect(out.endsWith("看看这个")).toBe(true);
	});

	it("formats diff comments as 文件 path 第 lines 行：comment", () => {
		const out = formatWithAnnotations("改这里", [
			ann({
				source: "diff",
				text: "+new line",
				file: "src/a.ts",
				lines: "10-12",
				comment: "这里写错了",
			}),
		]);
		expect(out).toContain("文件 src/a.ts 第 10-12 行：这里写错了");
	});

	it("works with an empty composer text", () => {
		const out = formatWithAnnotations("", [
			ann({ source: "doc", text: "quoted", file: "README.md" }),
		]);
		expect(out).toContain("[1]");
		expect(out).toContain("README.md");
	});
});

describe("useComposer store", () => {
	beforeEach(() => {
		localStorage.clear();
		useComposer.setState({
			annotations: {},
			drafts: {},
			history: [],
			focusNonce: {},
		});
	});

	it("persists drafts per session and supports clearing", () => {
		const c = useComposer.getState();
		c.setDraft("s1", "draft for session 1");
		c.setDraft("s2", "draft for session 2");
		expect(useComposer.getState().drafts["s1"]).toBe("draft for session 1");
		expect(useComposer.getState().drafts["s2"]).toBe("draft for session 2");

		c.clearDraft("s1");
		expect(useComposer.getState().drafts["s1"]).toBe("");
		expect(useComposer.getState().drafts["s2"]).toBe("draft for session 2");
	});

	it("records prompt history and ignores consecutive duplicates", () => {
		const c = useComposer.getState();
		c.pushHistory("first prompt");
		c.pushHistory("second prompt");
		c.pushHistory("second prompt"); // Duplicate should be ignored
		c.pushHistory("   "); // Blank should be ignored
		expect(useComposer.getState().history).toEqual([
			"first prompt",
			"second prompt",
		]);

		c.clearHistory();
		expect(useComposer.getState().history).toEqual([]);
	});

	it("increments focusNonce for a session", () => {
		const c = useComposer.getState();
		expect(useComposer.getState().focusNonce["s1"]).toBeUndefined();
		c.focusComposer("s1");
		expect(useComposer.getState().focusNonce["s1"]).toBe(1);
		c.focusComposer("s1");
		expect(useComposer.getState().focusNonce["s1"]).toBe(2);
	});

	it("updates annotations with updateAnnotation (comment or partial patch)", () => {
		const c = useComposer.getState();
		c.addAnnotation("s1", { source: "message", text: "引用文本" });
		const anns = useComposer.getState().annotations["s1"];
		expect(anns).toHaveLength(1);
		const id = anns[0].id;

		// Update with string patch (comment)
		c.updateAnnotation("s1", id, "修改后的批注");
		expect(useComposer.getState().annotations["s1"][0].comment).toBe("修改后的批注");

		// Update with partial patch
		c.updateAnnotation("s1", id, { comment: "再次修改", lines: "5-10" });
		expect(useComposer.getState().annotations["s1"][0].comment).toBe("再次修改");
		expect(useComposer.getState().annotations["s1"][0].lines).toBe("5-10");
	});

	it("caps history at 20 entries and persists to localStorage", () => {
		const c = useComposer.getState();
		for (let i = 0; i < 40; i++) {
			c.pushHistory(`prompt ${i}`);
		}
		const hist = useComposer.getState().history;
		expect(hist).toHaveLength(20);
		expect(hist[0]).toBe("prompt 20");
		expect(hist[19]).toBe("prompt 39");
		expect(localStorage.getItem("ompws:composer-history")).toContain("prompt 39");
	});

	it("manages image attachments per session (add, remove, clear)", () => {
		const c = useComposer.getState();
		const img1 = c.addImage("s1", "/path/1.png");
		const img2 = c.addImage("s1", "/path/2.png");
		expect(useComposer.getState().images["s1"]).toHaveLength(2);
		expect(useComposer.getState().images["s1"][0].path).toBe("/path/1.png");
		expect(useComposer.getState().images["s1"][1].path).toBe("/path/2.png");

		c.removeImage("s1", img1.id);
		expect(useComposer.getState().images["s1"]).toHaveLength(1);
		expect(useComposer.getState().images["s1"][0].id).toBe(img2.id);

		c.clearImages("s1");
		expect(useComposer.getState().images["s1"]).toEqual([]);
	});
});

describe("side-chat annotations", () => {
	beforeEach(() => {
		localStorage.clear();
		useComposer.setState({
			annotations: {},
			annotationTarget: "main",
		});
	});

	it("sideChatAnnKey namespaces staged annotations per parent", () => {
		expect(sideChatAnnKey("p1")).toBe("sidechat:p1");
		const c = useComposer.getState();
		c.addAnnotation("p1", { source: "message", text: "main quote" });
		c.addAnnotation(sideChatAnnKey("p1"), { source: "message", text: "side quote" });
		c.addAnnotation(sideChatAnnKey("p2"), { source: "message", text: "other parent" });
		const anns = useComposer.getState().annotations;
		expect(anns["p1"]).toHaveLength(1);
		expect(anns[sideChatAnnKey("p1")]).toHaveLength(1);
		expect(anns[sideChatAnnKey("p1")]![0]!.text).toBe("side quote");
		expect(anns[sideChatAnnKey("p2")]).toHaveLength(1);
		// Clearing the main composer must not drop staged side-chat annotations
		// (panel remount regression: staged data lives in the store, not in
		// SideChatPanel local state).
		c.clearAnnotations("p1");
		expect(useComposer.getState().annotations[sideChatAnnKey("p1")]).toHaveLength(1);
	});

	it("moveAnnotation preserves fields and moves between main and side-chat lists", () => {
		const c = useComposer.getState();
		c.addAnnotation("p1", { source: "message", text: "quoted", itemId: "item-9", comment: "note" });
		const src = useComposer.getState().annotations["p1"]![0]!;
		c.moveAnnotation("p1", sideChatAnnKey("p1"), src.id);
		let anns = useComposer.getState().annotations;
		expect(anns["p1"]).toHaveLength(0);
		const moved = anns[sideChatAnnKey("p1")]![0]!;
		expect(moved).toMatchObject({ source: "message", text: "quoted", itemId: "item-9", comment: "note" });
		c.moveAnnotation(sideChatAnnKey("p1"), "p1", moved.id);
		anns = useComposer.getState().annotations;
		expect(anns[sideChatAnnKey("p1")]).toHaveLength(0);
		expect(anns["p1"]![0]!.text).toBe("quoted");
	});

	it("moveAnnotation is a no-op for unknown ids", () => {
		const c = useComposer.getState();
		c.addAnnotation("p1", { source: "message", text: "quoted" });
		const before = useComposer.getState().annotations;
		c.moveAnnotation("p1", sideChatAnnKey("p1"), "missing");
		expect(useComposer.getState().annotations).toBe(before);
	});

	it("remembers the annotation destination in localStorage", () => {
		useComposer.getState().setAnnotationTarget("sidechat");
		expect(useComposer.getState().annotationTarget).toBe("sidechat");
		expect(localStorage.getItem("ompws:annotation-target")).toBe("sidechat");
	});
});

describe("attachImages", () => {
	it("numbers paths in order, reusing images already attached", () => {
		const c = useComposer.getState();
		c.addImage("att", "/x.png");
		expect(c.attachImages("att", ["/y.png", "/x.png", "/y.png"])).toEqual([2, 1, 2]);
		expect(useComposer.getState().images["att"].map((i) => i.path)).toEqual(["/x.png", "/y.png"]);
	});
});
