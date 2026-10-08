import { PRESET_THUMBNAILS, PRESET_WALLPAPERS_DATA } from "../assets/presetWallpapersData";

export type WallpaperVariant = "mono" | "neutral" | "soft" | "rich";
export type WallpaperEffect = "clear" | "soft" | "blur" | "overlay";
export type WallpaperAppearance = "dark" | "light";
export type WallpaperVeil = "none" | "white" | "black";
export interface WallpaperPalette {
  mono: string;
  neutral: string;
  soft: string;
  rich: string;
  appearance?: WallpaperAppearance;
  luminance?: number;
}

export interface PresetWallpaper {
  id: string;
  name: string;
  imageUrl: string;
  thumbnailUrl: string;
  palette: WallpaperPalette;
  appearance: WallpaperAppearance;
}

export interface WallpaperState {
  enabled: boolean;
  id: string;
  url: string;
  effect: WallpaperEffect;
  accentColor: string;
  variant: WallpaperVariant | "custom";
  appearance?: WallpaperAppearance;
  brightness?: number;
  veil?: WallpaperVeil;
}

export interface CustomWallpaperItem {
  id: string;
  name: string;
  url: string;
  path?: string;
  palette: WallpaperPalette;
  appearance: WallpaperAppearance;
  createdAt: number;
}

export const PRESET_WALLPAPERS: PresetWallpaper[] = [
  {
    id: "preset-lakewood",
    name: "雾林深境",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-lakewood"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-lakewood"],
    palette: { mono: "#6b7270", neutral: "#adb5b3", soft: "#2e5a44", rich: "#146b27" },
    appearance: "dark",
  },
  {
    id: "preset-palm-shore",
    name: "晴空花影",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-palm-shore"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-palm-shore"],
    palette: { mono: "#78828a", neutral: "#b1c7d8", soft: "#5a92ba", rich: "#d96b27" },
    appearance: "light",
  },
  {
    id: "preset-ember-rock",
    name: "月映暖筑",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-ember-rock"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-ember-rock"],
    palette: { mono: "#7c858a", neutral: "#a3bdc4", soft: "#c68867", rich: "#d87e4b" },
    appearance: "light",
  },
  {
    id: "preset-atoll-blue",
    name: "盐原金峰",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-atoll-blue"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-atoll-blue"],
    palette: { mono: "#828785", neutral: "#ced3d0", soft: "#a99273", rich: "#d4921e" },
    appearance: "light",
  },
  {
    id: "preset-leaf-shadow",
    name: "玄岩海门",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-leaf-shadow"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-leaf-shadow"],
    palette: { mono: "#636e6b", neutral: "#8b9c97", soft: "#1b4d3e", rich: "#007a99" },
    appearance: "dark",
  },
  {
    id: "preset-alpenglow",
    name: "黑羽静栖",
    imageUrl: PRESET_WALLPAPERS_DATA["preset-alpenglow"],
    thumbnailUrl: PRESET_THUMBNAILS["preset-alpenglow"],
    palette: { mono: "#727578", neutral: "#9fa2a4", soft: "#5c6b73", rich: "#9e623a" },
    appearance: "dark",
  },
];

export type Rgb = [number, number, number];

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): Rgb | null {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0..1. */
export function getLuminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** HSL saturation, 0..1. */
export function getSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

function rgbToHsl(r: number, g: number, b: number): Rgb {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, getSaturation(r, g, b), l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: Rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function hslHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  return rgbToHex(r, g, b);
}

const FALLBACK: WallpaperPalette = { mono: "#737373", neutral: "#a3a3a3", soft: "#5a7a9a", rich: "#3b82f6" };

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

/** Derive a 4-tier palette from RGBA pixel data. */
export function extractPaletteFromPixels(pixels: Uint8ClampedArray): WallpaperPalette {
  const buckets = new Map<number, Bucket>();
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    total++;
  }
  if (total === 0) return { ...FALLBACK };

  const colors = [...buckets.values()]
    .map((bk) => {
      const r = bk.r / bk.count, g = bk.g / bk.count, b = bk.b / bk.count;
      const [h, s, l] = rgbToHsl(r, g, b);
      return { count: bk.count, h, s, l };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 64);

  const dominant = colors[0];
  // Weighted average lightness for the overall image tone.
  let wl = 0, wc = 0;
  for (const c of colors) {
    wl += c.l * c.count;
    wc += c.count;
  }
  const avgL = wl / wc;

  // Vibrant: most saturated among meaningful buckets (>=1% of top colors or any if none), weighted by population.
  const minCount = Math.max(1, wc * 0.01);
  const candidates = colors.filter((c) => c.count >= minCount && c.l > 0.08 && c.l < 0.92);
  const pool = candidates.length ? candidates : colors;
  const vibrant = pool.reduce((best, c) =>
    c.s * Math.sqrt(c.count) > best.s * Math.sqrt(best.count) ? c : best,
  );
  const hue = vibrant.s > 0.05 ? vibrant.h : dominant.h;
  const baseS = vibrant.s;

  const mono = hslHex(dominant.h, Math.min(dominant.s, 0.06), clamp(avgL, 0.4, 0.55));
  const neutral = hslHex(dominant.h, Math.min(dominant.s, 0.15), clamp(avgL + 0.2, 0.6, 0.78));
  const soft = hslHex(hue, clamp(baseS * 0.7, 0, 0.45), clamp(vibrant.l, 0.3, 0.6));
  const rich = hslHex(hue, baseS < 0.05 ? baseS : clamp(baseS * 1.2, 0.55, 0.9), clamp(vibrant.l, 0.4, 0.55));
  const appearance: WallpaperAppearance = avgL >= 0.46 ? "light" : "dark";
  return { mono, neutral, soft, rich, appearance, luminance: avgL };
}

/** Load an image, downscale to <=128px side, and extract its palette. */
export async function extractPaletteFromImage(src: string): Promise<WallpaperPalette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, 128 / Math.max(w0, h0, 1));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== "undefined") {
    ctx = new OffscreenCanvas(w, h).getContext("2d");
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext("2d");
  }
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return extractPaletteFromPixels(ctx.getImageData(0, 0, w, h).data);
}
