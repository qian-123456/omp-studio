import { describe, expect, it } from "vitest";
import {
  extractPaletteFromPixels,
  getSaturation,
  hexToRgb,
  PRESET_WALLPAPERS,
  rgbToHex,
  type WallpaperPalette,
} from "./wallpaperPalette";

const HEX = /^#[0-9a-f]{6}$/;

function buffer(colors: Array<[number, number, number, number?]>, repeat = 50): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, a = 255] of colors) for (let i = 0; i < repeat; i++) out.push(r, g, b, a);
  return new Uint8ClampedArray(out);
}

function sat(hex: string): number {
  const rgb = hexToRgb(hex)!;
  return getSaturation(...rgb);
}

function expectValid(p: WallpaperPalette) {
  expect(p.mono).toMatch(HEX);
  expect(p.neutral).toMatch(HEX);
  expect(p.soft).toMatch(HEX);
  expect(p.rich).toMatch(HEX);
}

describe("extractPaletteFromPixels", () => {
  it("keeps grayscale images desaturated", () => {
    const p = extractPaletteFromPixels(buffer([[40, 40, 40], [128, 128, 128], [200, 200, 200]]));
    expectValid(p);
    for (const v of [p.mono, p.neutral, p.soft, p.rich]) expect(sat(v)).toBeLessThan(0.05);
  });

  it("orders saturation mono < soft < rich for colorful images", () => {
    const p = extractPaletteFromPixels(buffer([[30, 90, 200], [230, 80, 20], [120, 120, 110]]));
    expectValid(p);
    expect(sat(p.mono)).toBeLessThan(sat(p.soft));
    expect(sat(p.soft)).toBeLessThan(sat(p.rich));
    expect(sat(p.rich)).toBeGreaterThan(0.5);
  });

  it("lifts dark images into usable lightness", () => {
    const p = extractPaletteFromPixels(buffer([[5, 5, 10], [15, 10, 20]]));
    expectValid(p);
    const [r, g, b] = hexToRgb(p.neutral)!;
    expect((r + g + b) / 3).toBeGreaterThan(120);
  });

  it("ignores transparent pixels and falls back when none are opaque", () => {
    const p = extractPaletteFromPixels(buffer([[255, 0, 0, 0]]));
    expectValid(p);
    const q = extractPaletteFromPixels(buffer([[255, 0, 0, 10], [128, 128, 128]]));
    for (const v of [q.mono, q.neutral, q.soft, q.rich]) expect(sat(v)).toBeLessThan(0.05);
  });

  it("computes appearance and luminance correctly", () => {
    const dark = extractPaletteFromPixels(buffer([[10, 10, 10]]));
    expect(dark.appearance).toBe("dark");
    expect(dark.luminance).toBeLessThan(0.46);

    const light = extractPaletteFromPixels(buffer([[240, 240, 240]]));
    expect(light.appearance).toBe("light");
    expect(light.luminance).toBeGreaterThan(0.46);
  });
});

describe("color utils", () => {
  it("round-trips hex", () => {
    expect(rgbToHex(...hexToRgb("#1a2b3c")!)).toBe("#1a2b3c");
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("nope")).toBeNull();
  });

  it("has 6 valid presets", () => {
    expect(PRESET_WALLPAPERS).toHaveLength(6);
    for (const w of PRESET_WALLPAPERS) expectValid(w.palette);
  });
});
