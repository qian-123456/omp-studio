import { describe, expect, it } from "vitest";
import { computePosition, Z_LAYER } from "./FloatingLayer";

function makeRect(x: number, y: number, width: number, height: number): DOMRect {
	return {
		x,
		y,
		width,
		height,
		top: y,
		left: x,
		right: x + width,
		bottom: y + height,
		toJSON: () => ({}),
	} as DOMRect;
}

describe("computePosition edge cases", () => {
	it("flips bottom to top when no room below and more room above", () => {
		const anchor = makeRect(100, 600, 120, 30);
		const size = { width: 200, height: 200 };
		const offset = 4;
		const vp = { top: 8, bottom: 700, left: 8, right: 1000 };
		// roomBelow = 700 - (630 + 4) = 66 < 200
		// roomAbove = 600 - 4 - 8 = 588 > 66
		const pos = computePosition(anchor, size, "bottom-start", offset, vp);
		expect(pos.placement).toBe("top-start");
		// top should be anchor.top - offset - h = 600 - 4 - 200 = 396
		expect(pos.top).toBe(396);
		expect(pos.left).toBe(100);
	});

	it("clamps above the status bar / bottom viewport edge", () => {
		// Status bar starts at 700, so vp.bottom = 692 (700 - EDGE)
		const vp = { top: 8, bottom: 692, left: 8, right: 1000 };
		// Anchor row near the bottom of the sidebar
		const anchor = makeRect(16, 620, 150, 32);
		const size = { width: 280, height: 220 };
		const offset = 8;
		const pos = computePosition(anchor, size, "right-start", offset, vp);
		// Card top should be clamped upwards so pos.top + min(size.height, maxHeight) <= vp.bottom
		const renderedHeight = Math.min(size.height, pos.maxHeight);
		expect(pos.top + renderedHeight).toBeLessThanOrEqual(vp.bottom);
		expect(pos.top).toBeGreaterThanOrEqual(vp.top);
	});

	it("clamps right edge within the usable viewport", () => {
		const vp = { top: 8, bottom: 800, left: 8, right: 1000 };
		// Anchor on the right side of the screen
		const anchor = makeRect(850, 200, 100, 30);
		const size = { width: 300, height: 150 };
		const offset = 4;
		const pos = computePosition(anchor, size, "bottom-start", offset, vp);
		// Without clamping, left would be 850, and 850 + 300 = 1150 > 1000.
		// Clamped left must be <= vp.right - size.width = 1000 - 300 = 700
		expect(pos.left + size.width).toBeLessThanOrEqual(vp.right);
		expect(pos.left).toBeLessThanOrEqual(700);
		expect(pos.left).toBeGreaterThanOrEqual(vp.left);
	});

	it("flips right to left when no room on the right side", () => {
		const vp = { top: 8, bottom: 800, left: 8, right: 1000 };
		const anchor = makeRect(850, 200, 100, 30);
		const size = { width: 200, height: 100 };
		const offset = 8;
		// roomRight = 1000 - (950 + 8) = 42 < 200
		// roomLeft = 850 - 8 - 8 = 834 > 42
		const pos = computePosition(anchor, size, "right-start", offset, vp);
		expect(pos.placement).toBe("left-start");
		expect(pos.left).toBe(850 - offset - size.width);
	});
});

describe("computePosition centered surfaces", () => {
	it("centers small content inside the usable viewport", () => {
		const vp = { top: 8, bottom: 700, left: 8, right: 1000 };
		const pos = computePosition(makeRect(0, 0, 0, 0), { width: 400, height: 300 }, "center", 0, vp);
		expect(pos).toEqual({ left: 304, top: 204, maxHeight: 692, placement: "center" });
	});

	it("limits tall content to the viewport and keeps it fully visible", () => {
		const vp = { top: 8, bottom: 700, left: 8, right: 1000 };
		const pos = computePosition(makeRect(0, 0, 0, 0), { width: 460, height: 900 }, "center", 0, vp);
		expect(pos.maxHeight).toBe(692);
		expect(pos.top).toBe(vp.top);
		expect(pos.top + pos.maxHeight).toBe(vp.bottom);
	});
});

describe("Z_LAYER stacking", () => {
	it("keeps the image lightbox above popover, menu and hovercard but below toast", () => {
		expect(Z_LAYER.lightbox).toBeGreaterThan(Z_LAYER.hovercard);
		expect(Z_LAYER.lightbox).toBeGreaterThan(Z_LAYER.menu);
		expect(Z_LAYER.lightbox).toBeGreaterThan(Z_LAYER.popover);
		expect(Z_LAYER.lightbox).toBeLessThan(Z_LAYER.toast);
	});
});
