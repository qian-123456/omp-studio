---
name: visualize
description: "Render a chart, diagram, or interactive simulation inline in the conversation. Use when the user asks to visualize, compare, explore 'what happens when', or show how something works — and a small interactive or visual answer materially beats prose. Not for files, websites, or app pages."
---


# Visualize

Render a small visual — chart, diagram, interactive simulation — inline in your answer. The sandboxed host draws it directly in the conversation.

## When to use

- The user wants to *see* something: a trend, a comparison, a mechanism, a "what happens when I change X".
- A request to preview or explore an idea in the conversation counts; a request for a standalone file, website, page, or component does not — build that in the project instead.
- Keep it honest: only create a visual when it materially improves the answer. A Markdown table stays a Markdown table; a short list stays a list.
- One visual per answer, sized to the question. Static observations are fine; interaction is optional, never decorative.

## Output format

Emit exactly one fenced code block whose info string is `visualize` (standard width, ~736px) or `visualize wide` (wider surface, ~1024px — use only when several panels must sit side by side to be compared):

````
```visualize
<div id="my-viz-root">…</div>
<style>…</style>
<script>…</script>
```
````

- The block body is an **HTML fragment**: no `<!doctype>`, `<html>`, `<head>`, or `<body>`.
- Literal markup only — write real newlines and unescaped quotes; never a stringified `<div class=\"x\">`.
- **Always accompany the block with one or two sentences of normal prose outside the fence** saying what the visual shows or lets the user try. Never mention the fence, the skill, HTML, iframes, or "widgets" in that prose.
- The block renders only once its closing fence is written; while it is still open the user sees a loading placeholder, so emit it in one go and do not leave it unterminated.

## Fragment rules

- One root element with a unique `id`; query it with `document.getElementById(...)`. Do not rely on `document.currentScript`.
- No network I/O: no `fetch`, XHR, WebSocket, SSE, `navigator.sendBeacon`, `navigator.mediaDevices`, or dynamic `import()` — except static `<script src>` / `<link>` / `import` from this allowlist only: `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, `fonts.bunny.net`. Everything else fails silently.
- Keep the fragment under ~200 KB all-in. Bin, downsample, or aggregate large datasets inline; never paste raw dumps.
- Self-check before finishing: no undefined identifiers, every queried element exists, and the main interaction visibly changes the output.
- Keep the fragment focused on the visual itself: labels, legend, values, controls. No preamble paragraphs or usage essays inside it.
- Never include secrets or private data.

## Theme

The host restyles its UI between light and dark. Hard-coded colors (`white`, `#fff`, `black`, slate palettes) will break one of the two themes. Use these CSS variables for every fill, stroke, text color, border, and shadow:

`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, and chart series `--viz-series-1` … `--viz-series-6`.

- Surface tokens pair with `*-foreground` tokens: text on `--card` uses `--card-foreground`. Never use a surface token as text color. When you need a secondary/muted text color, write `var(--muted-foreground, var(--foreground))` so it also works where only the base list above is defined.
- Chart series: use `--viz-series-1` for the primary measure; `2`–`6` only for genuinely distinct series. Cycle them; do not invent literal colors.
- Canvas and charting libraries that cannot parse CSS variables need resolved colors: read them with `getComputedStyle`, re-read `window.openai.theme` on render, and redraw if you also listen for `openai:set_globals` (its `event.detail.globals.theme` may carry theme changes).
- Prefer `currentColor` inside SVG so labels and icons inherit the theme.

## Host bridge

A `window.openai` object is available inside the fragment:

```ts
window.openai = {
  theme: "light" | "dark",              // current host theme
  widgetState: unknown,                  // last persisted state (or null)
  setWidgetState(state): Promise<void>,  // persist <= 16 KB of JSON; call after meaningful interaction, never on load
  sendFollowUpMessage(text: string): Promise<void>, // send a follow-up prompt back into this conversation
  openExternal(url: string): void,       // open a URL externally; must be called from a real user click/keypress
}
```

- `sendFollowUpMessage` is for drill-downs that hand work back to the assistant ("investigate this slice"), not for UI state. Label such actions clearly.
- `setWidgetState` is best-effort; treat missing or stale state as defaults. No secrets, no images.
- Do not expect any other globals: there is no preloaded icon library, CSS framework, or chart library. Hand-author simple SVG or load a charting library from the CDN allowlist (e.g. D3: `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js`).

## Layout

- The root background must stay transparent and unframed; fill the available width and design for ~736px (or ~1024px in `wide`), still working at 320px. Stack side-by-side content when it no longer fits.
- The host sizes the frame to the content: no fixed outer widths, no `position: fixed`, no `100vh` layouts, no internal scrollbars. Crop empty space; keep one dominant visual and at most a single compact control row.
- Size every SVG/canvas from its container (`ResizeObserver` + `viewBox`); at narrow widths drop ticks and annotations rather than shrink text below 11px. Keep ~90×50px clear at a top corner for host controls.

## Accessibility checklist

- Semantic HTML and native `button`/`input`/`select` controls; full keyboard operability; keep native focus styles and default tab order (no custom `tabindex`).
- Give every chart/diagram a text summary: `role="img"` + `aria-label`, `<title>`/`<desc>` in SVG, or an `.sr-only` description — and label axes with quantities and units.
- Announce dynamic results with `aria-live="polite"` on the region that changes; never announce per-frame updates.
- Honor `prefers-reduced-motion` (skip or simplify animation); never auto-loop motion; nothing essential behind hover.
- Touch targets ~44px on coarse pointers; minimum 11px for visible text; pair color with a label, shape, or line style so meaning never depends on hue alone; `tabular-nums` for live-updating numbers.

## Examples

Each is a complete fragment — adapt, don't pad.

### Chart (pure SVG, no dependencies)

````
```visualize
<div id="sales-chart" role="img" aria-label="Monthly revenue bar chart: Jan 12k rising to Mar 21k">
  <svg viewBox="0 0 320 160" width="100%" style="color: var(--foreground)">
    <title>Monthly revenue</title>
    <g stroke="var(--border)"><line x1="34" y1="130" x2="306" y2="130"/></g>
    <g fill="var(--viz-series-1)">
      <rect x="50"  y="70"  width="60" height="60" rx="3"/>
      <rect x="140" y="46"  width="60" height="84" rx="3"/>
      <rect x="230" y="22"  width="60" height="108" rx="3"/>
    </g>
    <g fill="var(--foreground)" font-size="11" text-anchor="middle">
      <text x="80" y="146">Jan</text><text x="170" y="146">Feb</text><text x="260" y="146">Mar</text>
      <text x="80" y="62">12k</text><text x="170" y="38">17k</text><text x="260" y="14">21k</text>
    </g>
  </svg>
</div>
```
````

### Interactive simulation (one slider drives the visual)

````
```visualize
<div id="grav-sim">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <label for="grav-v">Initial velocity: <span id="grav-out" style="font-variant-numeric:tabular-nums">8</span> m/s</label>
    <input id="grav-v" type="range" min="1" max="15" step="1" value="8" style="flex:1;min-width:140px">
  </div>
  <svg id="grav-svg" viewBox="0 0 320 120" width="100%" role="img"
       aria-label="Projectile arc for the chosen velocity"></svg>
  <p id="grav-readout" aria-live="polite" style="color:var(--muted-foreground,var(--foreground));font-size:12px;margin:4px 0 0"></p>
</div>
<script>
  const root = document.getElementById('grav-sim');
  const slider = root.querySelector('#grav-v');
  const out = root.querySelector('#grav-out');
  const svg = root.querySelector('#grav-svg');
  const readout = root.querySelector('#grav-readout');
  function draw() {
    const v = +slider.value;
    out.textContent = v;
    const range = v * v / 9.81, hmax = v * v / (4 * 9.81);
    const sx = 280 / Math.max(range, 1), sy = 100 / Math.max(hmax, 1);
    let d = 'M20 100';
    for (let x = 0; x <= range; x += range / 40) {
      const y = v * (x / v) - 4.905 * (x / v) * (x / v); // y(x) with vx=v, vy=v
      d += ` L${20 + x * sx} ${100 - Math.max(0, y) * sy}`;
    }
    svg.innerHTML =
      `<line x1="20" y1="100" x2="300" y2="100" stroke="var(--border)"/>` +
      `<path d="${d}" fill="none" stroke="var(--viz-series-1)" stroke-width="2"/>`;
    readout.textContent = `Range ≈ ${range.toFixed(1)} m · peak ≈ ${hmax.toFixed(1)} m`;
  }
  slider.addEventListener('input', draw);
  draw();
</script>
```
````

### Diagram (labeled nodes and flows)

````
```visualize
<figure id="pipeline-fig" style="margin:0">
  <svg viewBox="0 0 340 96" width="100%" role="img"
       aria-label="Request flows through cache, handler, then database">
    <defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0L10 5L0 10z" fill="var(--muted-foreground,var(--foreground))"/>
      </marker>
    </defs>
    <g font-size="12" text-anchor="middle">
      <g fill="var(--card)" stroke="var(--border)">
        <rect x="8"   y="28" width="96" height="40" rx="8"/>
        <rect x="122" y="28" width="96" height="40" rx="8"/>
        <rect x="236" y="28" width="96" height="40" rx="8"/>
      </g>
      <g fill="var(--card-foreground)">
        <text x="56" y="52">Cache</text><text x="170" y="52">Handler</text><text x="284" y="52">Database</text>
      </g>
      <g stroke="var(--muted-foreground,var(--foreground))" fill="none" marker-end="url(#arr)">
        <line x1="104" y1="48" x2="120" y2="48"/><line x1="218" y1="48" x2="234" y2="48"/>
      </g>
    </g>
  </svg>
</figure>
```
````

## Final checklist before sending

1. Fragment-only HTML, unique root id, closing fence present, a short explanation outside the fence.
2. Under ~200 KB; no network calls; CDN loads only from the allowlist.
3. All colors from theme variables; readable in both light and dark.
4. Keyboard usable, labeled, summarized for screen readers, `aria-live` on live output, reduced-motion respected.
