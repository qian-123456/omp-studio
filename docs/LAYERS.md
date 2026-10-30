# Stacking layers

Single source of truth: `Z_LOCAL` / `Z_LAYER` in `src/components/FloatingLayer.tsx`.
`:root` CSS vars `--z-*` in `src/index.css` mirror them; `src/lib/zLayerGuard.test.ts`
fails if they drift or if any raw z-index appears in `src/`.

## Tiers (low → high)

| Tier | Value | Rule | Lives here |
|---|---|---|---|
| local (`Z_LOCAL`) | 0 / 10 / 20 / 30 / 40 | Stacking *inside one component* only (sticky header above rows, badge above sibling, splitter handle). Never for anything that floats or overlays the page. Tailwind `z-0/10/20/30/40`. | sticky group headers, annotation markers, session row tray, sketch toolbars, app chrome header/handles |
| `pill` | 50 | Overlay scroll pills of ordinary page scrollers; also the invisible splitter-drag shield. Above every local value, below every floating tier. | `scrollPills.ts`, `.scroll-pill`, drag shield in `App.tsx` |
| `drawer` | 100 | Side sheets that overlay the window but are not blocking dialogs. | Skills detail drawer |
| `popover` | 200 | Anchored panels opened by a click: pickers, stats, ideas panel, slash menu, terminal find bar. | `FloatingLayer layer="popover"`, sidebar mode menu |
| `menu` | 300 | Action/context menus; above popovers they may be opened from. | `FloatingLayer layer="menu"`, queued-message menu, selection bubble |
| `modal` | 400 | Blocking dialogs with a backdrop: `confirmDialog`/`promptDialog`, settings, provider/oauth/model dialogs, session dialogs, diff modal, sketch editor. | `lib/dialogs.tsx`, `SettingsOverlay`, `*Dialog`, `*Modal` |
| `hovercard` | 500 | Hover-only previews. Hidden by `FloatingLayer` while a modal is open. | `SessionHoverCard`, stats hover, chat-trace tooltip |
| `lightbox` | 600 | Full-screen image viewer; must cover whatever spawned it. | `ImagePreviewModal` |
| `toast` | 700 | Always on top. | `Toaster`, undo toast in settings |

A scroll pill whose scroller sits inside a floating tier is drawn at that tier's z + 1
(`pillZIndex` in `scrollPills.ts`, derived from the table).

## Nesting rule

A floating layer opened from inside another floating surface sits at
`max(own tier, parent z + 1)`. `FloatingLayer` implements it: for an element anchor it
walks the anchor's ancestors and lifts itself above the highest ancestor with
z-index ≥ `drawer` (`nestedZ`). Consequences:

- `ModelSelect` / any popover or menu opened inside a dialog renders above the dialog.
- A `confirmDialog` (modal tier) opened from the ideas panel (popover tier,
  `IdeasCapsule`) renders above the panel and its backdrop covers it; while it is open the
  panel does not dismiss on clicks/Escape handled by the dialog (`modalAbove`).
- A menu opened from a popover stays above it.

Rect/point anchors (context menus at the cursor) have no parent and use their own tier.

## Adding a new overlay

1. Anchored popover/menu/hover card → `<FloatingLayer layer="popover|menu|hovercard" …>`.
2. Blocking dialog or other full-screen surface → use `components/Modal.tsx` (portal to
   `document.body` on `Z_LAYER.modal`, backdrop/Escape/focus-restore built in). Hand-rolled
   surfaces portal to `document.body` and set `className="… z-(--z-modal)"` (or
   `style={{ zIndex: Z_LAYER.modal }}`).
3. Never write `z-50`, `z-[..]` or numeric `zIndex`. Only `z-0/10/20/30/40` for purely
   local stacking inside one card/panel.
4. A `FloatingLayer`'s `className` is skin only. Placement (`position: fixed`, `left`/`top`,
   `z-index`, `max-height`, `visibility`) is pinned inline by the primitive, so a position
   utility in the skin (`relative`, `absolute`, `sticky`) cannot silently drop the layer into
   normal flow — where `top` becomes an offset from the page bottom and the dialog opens
   outside the window.
5. Need a new tier? Add it to `Z_LAYER` **and** `index.css`, then update this table; the
   guard test checks both agree.
