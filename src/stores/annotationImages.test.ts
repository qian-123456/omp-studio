import { beforeEach, describe, expect, it } from "vitest";
import { annotationImageAttachments, formatWithAnnotations, useComposer } from "./composer";

beforeEach(() => {
	useComposer.setState({ annotations: {}, images: {} });
});

describe("annotation images", () => {
	it("image-only annotation is kept, formatted and yields attachments", () => {
		const c = useComposer.getState();
		c.addAnnotation("s", { source: "message", text: "quoted", images: ["/a.png"] });
		const anns = useComposer.getState().annotations.s;
		expect(anns[0].images).toEqual(["/a.png"]);
		expect(formatWithAnnotations("hi", anns)).toBe("[1]\n> quoted\n批注：[图片: /a.png]\n\nhi");
		expect(annotationImageAttachments(anns)).toEqual([
			expect.objectContaining({ path: "/a.png", marker: "[图片: /a.png]" }),
		]);
	});

	it("never copies images into the composer list; removing the annotation releases them", () => {
		const c = useComposer.getState();
		c.addAnnotation("s", { source: "message", text: "q", images: ["/a.png"] });
		expect(useComposer.getState().images.s ?? []).toEqual([]);
		const id = useComposer.getState().annotations.s[0].id;
		useComposer.getState().removeAnnotation("s", id);
		expect(annotationImageAttachments(useComposer.getState().annotations.s)).toEqual([]);
	});

	it("dedupes against composer attachments and across annotations", () => {
		const anns = [
			{ id: "1", source: "message" as const, text: "q", images: ["/a.png", "/b.png"] },
			{ id: "2", source: "message" as const, text: "r", images: ["/b.png", "/c.png"] },
		];
		const out = annotationImageAttachments(anns, [{ path: "/a.png" }]);
		expect(out.map((i) => i.path)).toEqual(["/b.png", "/c.png"]);
	});

	it("editing and moving keep the images on the annotation", () => {
		const c = useComposer.getState();
		c.addAnnotation("s", { source: "message", text: "q", images: ["/a.png", "/b.png"] });
		const id = useComposer.getState().annotations.s[0].id;
		useComposer.getState().updateAnnotation("s", id, { images: ["/b.png"] });
		expect(useComposer.getState().annotations.s[0].images).toEqual(["/b.png"]);
		useComposer.getState().moveAnnotation("s", "sidechat:s", id);
		expect(useComposer.getState().annotations["sidechat:s"][0].images).toEqual(["/b.png"]);
		expect(useComposer.getState().annotations.s).toEqual([]);
	});
});

describe("annotation image ownership", () => {
	it("deleting one annotation leaves ordinary images and another annotation's shared path intact", () => {
		const c = useComposer.getState();
		c.addImage("s", "/shared.png");
		c.addAnnotation("s", { source: "message", text: "q1", images: ["/shared.png"] });
		c.addAnnotation("s", { source: "message", text: "q2", images: ["/shared.png", "/own.png"] });
		const [first, second] = useComposer.getState().annotations.s;
		useComposer.getState().removeAnnotation("s", first.id);
		const st = useComposer.getState();
		expect(st.images.s.map((i) => i.path)).toEqual(["/shared.png"]);
		expect(st.annotations.s).toHaveLength(1);
		expect(st.annotations.s[0].id).toBe(second.id);
		expect(st.annotations.s[0].images).toEqual(["/shared.png", "/own.png"]);
		// Outgoing union: the ordinary image wins the shared path, the annotation adds only its own.
		expect(
			annotationImageAttachments(st.annotations.s, st.images.s).map((i) => i.path),
		).toEqual(["/own.png"]);
	});
});
