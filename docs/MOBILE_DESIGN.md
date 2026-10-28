# Phone app design contract (src-mobile)

This is the visual and interaction contract of the phone web app. `docs/MOBILE_PRD.md` says
*what* exists; this file says *how it looks and behaves*. Every screen uses the primitives in
`src-mobile/ui/` and the tokens in `src-mobile/styles/tokens.css` — no hand-rolled lookalikes.

Reference material (read, do not copy assets): Gemini iOS screenshots
`~/.omp-workspace/images/1793024036951.png` (home), `…049723.png` (drawer), `…087803.png`
(settings sheet); static replica `.cache/gemini-ios-layout-draft/` (if present).
The repo is public (MIT): never bundle Google Sans, the Gemini sparkle, ChatGPT/APK icons or any
other third-party brand asset. System fonts + `lucide-react` icons + our own `AppMark` only.

## 1. Personality

**Gemini iOS look, ChatGPT iOS interaction logic.**

- Calm, borderless, generous. Separation comes from surface tone and spacing, not outlines.
  Hairline borders only for inset list separators and inputs.
- Big round shapes: default 44px circle icon buttons (small discs can sit inside the same hit
  area), capsule composer, 24px-radius grouped cards, 28px-radius sheets. Compact control
  sizes are documented below; do not replace the shared primitives with square boxes.
- Few colours. Neutral greys + one blue accent. Status colours only in small chips/dots.
- Content first: assistant text is plain full-width text on the page; the user's message is a
  soft capsule bubble on the right. Machine detail (tools, thinking) is one quiet line that
  expands on tap.
- ChatGPT interaction logic: plus button opens an attachment/actions sheet; model title opens a
  picker sheet; tap a collapsed line to expand; long-press a message for actions; swipe from
  the left edge (or tap ≡) for the drawer; floating ↓ button when scrolled up; send turns into
  stop while generating.

## 2. Tokens (`styles/tokens.css`)

One design, two schemes: `html[data-scheme="dark|light"]` (follows system unless the user picks
one in Settings ▸ 外观). There is no skin switch or separate selectable legacy skin; the
scheme changes colours, not the component design.

| token | dark | light | use |
|---|---|---|---|
| `--m-bg` | `#000000` | `#ffffff` | page canvas |
| `--m-bg-elev` | `#101012` | `#f3f5f9` | sheets, drawer, settings canvas |
| `--m-surface` | `#2a2b2e` | `#e9edf3` | circle buttons, pills, input fields |
| `--m-surface-2` | `#37393d` | `#dce2ea` | pressed states, nested blocks |
| `--m-surface-hover` | `rgb(255 255 255 / .08)` | `rgb(0 0 0 / .05)` | `:active` overlay |
| `--m-card` | `#1f2022` | `#ffffff` | grouped list cards (on `--m-bg-elev`) |
| `--m-segment-on` | `#45474b` | `#ffffff` | selected segmented-control pill |
| `--m-border` | `rgb(255 255 255 / .10)` | `rgb(0 0 0 / .08)` | hairlines, separators |
| `--m-border-strong` | `rgb(255 255 255 / .22)` | `rgb(0 0 0 / .18)` | input outlines |
| `--m-text` | `#e8eaed` | `#1f1f1f` | primary text |
| `--m-text-2` | `#c4c7c5` | `#444746` | secondary text, icons |
| `--m-text-3` | `#8e918f` | `#747775` | captions, placeholders |
| `--m-accent` | `#a8c7fa` | `#0b57d0` | links, selected, focus |
| `--m-accent-text` | `#062e6f` | `#ffffff` | text on `--m-accent` |
| `--m-accent-soft` | `#1f3760` | `#d3e3fd` | send button, tinted selection |
| `--m-accent-soft-text` | `#d3e3fd` | `#041e49` | text/icon on `--m-accent-soft` |
| `--m-link` | `#a8c7fa` | `#0b57d0` | links |
| `--m-danger/-warn/-success` | `#f2b8b5` `#fdd663` `#6dd58c` | `#b3261e` `#8a5100` `#146c2e` | status text/dots |
| `--m-danger-bg` | `rgb(242 184 181 / .14)` | `#fce8e6` | danger chip background |
| `--m-warn-bg` | `rgb(253 214 99 / .14)` | `#fef3d4` | warning chip background |
| `--m-success-bg` | `rgb(109 213 140 / .14)` | `#e6f4ea` | success chip background |
| `--m-bubble-user-bg` | `#26272a` | `#e9eef6` | user bubble |
| `--m-bubble-user-text` | `#e8eaed` | `#1f1f1f` | user bubble text |
| `--m-composer-bg` | `#1e1f20` | `#ffffff` | composer, distinct from generic surface |
| `--m-code-bg` / `--m-code-text` | `#141416` / `#e8eaed` | `#f0f2f6` / `#1f1f1f` | code blocks |
| `--m-inline-code-bg` / `--m-inline-code-text` | `#26272a` / `#e8eaed` | `#eef0f3` / `#1f1f1f` | inline code |
| `--m-diff-add` / `--m-diff-del` | `rgb(109 213 140 / .18)` / `rgb(242 184 181 / .2)` | `rgb(20 108 46 / .12)` / `rgb(179 38 30 / .12)` | diff backgrounds |
| `--m-scrim` | `rgb(0 0 0 / .6)` | `rgb(0 0 0 / .32)` | overlay scrim |

Type (system stack: SF Pro / PingFang SC; mono: SF Mono / Menlo):

| token | size/line | use |
|---|---|---|
| `--m-fs-display` | 30/38, weight 400 | home greeting (drawer brand uses `--m-fs-lg`) |
| `--m-fs-title` | 28/34, weight 500 | large sheet/page title (设置) |
| `--m-fs-lg` | 20/26, weight 500 | section headings inside pages |
| `--m-fs-body` | 17/28 | message text (CJK needs the extra leading) |
| `--m-fs-md` | 17/22 | list rows, buttons, inputs |
| `--m-fs-sm` | 15/20 | secondary lines, tool lines |
| `--m-fs-xs` | 13/18 | captions, section labels, chips |

These are defaults, not a fixed message-size requirement: `--m-msg-fs` defaults to
`--m-fs-body` and Settings ▸ 外观 can override it. Line-height utilities are bound in
`styles/base.css`; `--m-lh-body` is 28px. `--m-assistant-bg` is transparent.

Radius: `--m-r-sm 12px` (inline chips, code), `--m-r-md 18px` (small cards, tool details),
`--m-r-lg 24px` (grouped cards, plan/question cards), `--m-r-xl 28px` (sheet top, dialogs),
`--m-r-pill 9999px`.
Spacing: 4-pt grid; page gutter `--m-gutter 16px`; thread gutter `--m-thread-gutter 20px`.
`--m-touch` is 44px; every interactive target must meet the ≥44×44px acceptance requirement.
Motion: `--m-ease cubic-bezier(.2,0,0,1)`, `--m-ease-sheet cubic-bezier(.32,.72,0,1)`;
fast 160ms, base 260ms, sheet 380ms. Respect `prefers-reduced-motion`.
Elevation: `--m-shadow-card` is `none` in dark mode and a subtle
`0 1px 2px rgb(31 31 31 / .06)` in light mode. The composer uses
`--m-composer-shadow` (`none` in dark; `0 2px 12px rgb(31 31 31 / .1),
0 0 1px rgb(31 31 31 / .18)` in light), not the stronger `--m-shadow-pop`.
`--m-shadow-pop` is for floating controls, dialogs, toasts and menus: dark
`0 8px 32px rgb(0 0 0 / .5)`; light `0 8px 28px rgb(31 31 31 / .14),
0 0 1px rgb(31 31 31 / .2)`.

## 3. Primitives (`src-mobile/ui/`)

| primitive | look | API notes |
|---|---|---|
| `IconButton` | 44px-high, ≥44px-wide hit area; default 44px disc, `size="sm"` 36px disc inside the same target. `variant="filled"` = `--m-surface`, `"plain"` = transparent, `"tinted"` = `--m-accent-soft` | `icon`, `label` (aria), `onClick`, `badge?` |
| `TopBar` | 56px row under safe area: left slot, flexible centre, right slot; page background, no border | used by home + chat |
| `PageHeader` | sub-page header: filled circle back button, 17/600 centred title (+ optional subtitle), right slot; `large` adds a 28px left-aligned title below the bar | `onBack={false}` hides back |
| `BottomSheet` | `--m-bg-elev`, top radius 28, grab handle 36×5. Default (menu) sheet: auto height, centred 17/600 title. `fullHeight`: visual viewport height minus safe top and 12px; handle, close circle top-right, large left title | drag header down / scrim / back closes |
| `ListGroup` + `ListRow` | 24-radius `--m-card` card; rows ≥ 56px: 22px icon in `--m-text-2`, 17px label, optional 13px subtitle, right value + chevron; separators inset to the label start | `ListGroup title?` renders the 13px grey section label above |
| `MenuRow` | flat row for action sheets (no card): icon + label (+ hint), ≥ 52px | ChatGPT-style menus |
| `Switch`, `Segmented`, `Stepper` | switch: 51×31 track in a ≥44px-high target; segmented: `--m-surface` track, `--m-segment-on` selected pill, ≥44×44px segments; stepper: non-shrinking 44×44 circle ± buttons and a 44px-high numeric input with ≥44px width | shared `controls.tsx` |
| `Button` | capsule. `primary` (`--m-text` bg, `--m-bg` text), `tonal` (`--m-surface`, default), `accent` (`--m-accent-soft`), `danger` (danger text on danger-bg), `ghost`; both `size="md"` and `"sm"` reserve ≥44×44px layout targets; `"sm"` uses smaller text/padding; `block` stretches | never "…" in labels; busy disables the action |
| `Chip` | noninteractive: 24px-high capsule; clickable: ≥44×44px layout bounds, not an overlapping negative-inset hit extension; 13px text, tones neutral/accent/success/warn/danger | clickable layout must reserve the full target |
| `TextField` / `inputCls` | ≥48px high, radius 14, `--m-surface` fill, borderless with an accent focus ring | `Field` supplies label, hint or error |
| `Dialog` / `confirm()` | centred 28-radius `--m-bg-elev` card, 20px title, body, capsule buttons | |
| `toast()` | inverse capsule (`--m-text` bg) floating above the composer | |
| `EmptyState` | 56px `--m-surface` circle icon, 17/600 title, 15px grey hint, optional Button | |
| `AppMark` | our gradient four-point star (blue → violet → rose), sizes 24–48 | home greeting, drawer title |

## 4. Screens

### 4.1 Top bar (home + chat)
`[≡ filled]  模型名 思考档 ⌄ (plain text button, 17px; model in --m-text, effort in --m-text-3)`
`… flex … [新对话 filled] [工具 filled]`. The title button opens the model + thinking sheet.
On home the 工具 button is hidden (no session yet). No status text under the title.

### 4.2 Home
Black (or white) canvas; dark mode gets a very soft blue radial glow rising from the bottom
(like the reference), light mode a faint pastel one. Centre: `AppMark` 40px + greeting
「今天想做点什么？」 in `--m-fs-display`. No chips/suggestions, no mode tabs, no username.
Bottom: the same composer as chat (§4.4). Sending creates the session in the default folder and
replaces the route with the chat; the user's text appears immediately (optimistic), never an
error page.

### 4.3 Drawer (full-screen, slides from the left)
Covers the whole screen (`--m-bg`), swipe-left or ✕ closes.
- Header: `AppMark` + 「OMP」 brand in `--m-fs-lg`, right: search circle, close circle.
- 「发起新对话」 full-width `--m-surface` capsule (pencil icon, left aligned), then flat rows
  「定时任务」 (clock). Search lives in the header button.
- Space switcher (代码 / 通用对话 / 学习…) as a small tonal pill with chevron, next to a
  `Segmented` 「按项目 | 按时间」.
- 按项目: project row = folder icon + name (full path on second line, wrapped, 13px grey) +
  count chip + `+` circle. Reuse registered worktrees by `workspaceId` and their actual `cwd`,
  including paths outside the project directory; worktree rows are indented with a branch icon.
  New worktrees must be created and registered on desktop; mobile must explain this limitation,
  not imply that it creates a worktree or silently substitute the main project directory.
  Session rows: title (wrap to 2 lines max is OK; full title on long-press sheet), relative
  time, status dot (running = pulsing accent, needs-you = warn, error = danger).
- 按时间: date-grouped sections (今天 / 昨天 / 本周 / 更早) of session rows with status dot.
- Bottom bar (pinned, `--m-bg` with top hairline): 收件箱 (bell + count badge) · 订阅与配额 ·
  设置 gear — three equal tappable cells with icon above a 13px label, or icon+label rows.

### 4.4 Composer
Floating capsule at the bottom, 16px side margin, `--m-composer-bg` with
`--m-composer-shadow`, radius 28, min height 56. Single-line: `[+]  placeholder  [🎤] [send]`. When text wraps the
capsule grows (max 40% of viewport) and the buttons stay on the bottom row.
- `+` opens the ChatGPT-style **actions sheet**: top row of three large tiles
  (文件 · Finder 选中项 · 草图), then `MenuRow`s: 在项目中工作, 目标, 规划模式 (with a Switch).
- Mic: tap to record (button turns into a red pulsing stop), transcript is inserted at the
  caret, never auto-sent.
- Send: 40px circle, `--m-accent-soft`; disabled look when empty. While generating it is a
  stop button (square icon) in the same place.
- Status row above the capsule (13px, `--m-text-3`, no background): left = folder icon +
  folder name (tap → sheet with full path + switch), right = 「上下文 37%」 (tap → compact
  sheet with a usage bar and 「压缩上下文」 button). Plan mode shows a small accent capsule
  「规划模式 ✕」 at the left of this row instead of the folder.

### 4.5 Thread
- User message: right-aligned capsule bubble, `--m-bubble-user-bg`, radius 24 (single line =
  full capsule), padding 12×18, max width 85%, 17px.
- Assistant: full-width plain text, `--m-fs-body`, no avatar, 20px gutter.
- Thinking: one line 「已思考 12 秒 ›」 in `--m-text-3`; while running 「思考中」 with a
  shimmering text effect. Tap expands the reasoning in a quiet left-ruled block.
- Tools: consecutive tool calls collapse into one line 「已运行 6 个步骤 · 57 秒 ›」.
  Expanded: each tool is a row (icon, verb + target in one readable line, status). Tap a row
  for args/result in an 18-radius `--m-surface` block, full text, monospace, horizontally
  scrollable for code only. Errors show in full in danger text.
- Turn footer: icon-only plain buttons (copy, retry, more) 13px grey, plus a quiet 13px stat
  text (time · tokens) — no emoji.
- Plan card, question card, approval card: 24-radius `--m-surface` cards, title row with icon,
  body, capsule buttons at the bottom (primary on the right). Questions: progress 「问题 1/3」,
  radio/checkbox rows ≥ 52px, free-text field, 跳过 / 上一题 / 下一题.
- ↓ button: 40px filled circle centred above the composer when not at bottom.
- Subagent capsule: small pill floating at the top-right of the thread (below the top bar),
  e.g. 「● 2 运行 · 5 完成」; never overlaps text horizontally — it is part of a sticky row with
  its own height, not absolutely positioned over content.

### 4.6 Sheets and pickers
- Model + thinking sheet: thinking levels from the model's catalog as a `Segmented` (or slider)
  on top; below, providers as rows → tap drills into that provider's models (back chevron);
  search field at the top flattens results. Selected model shows a check.
- Tools sheet (工具 button): 5 rows — 文件, Git, 终端, 辅助对话, 服务 (icon + hint).
- Action sheets: `MenuRow`s, destructive rows in danger colour at the end.

### 4.7 Settings (`/settings`)
Gemini settings sheet layout rendered as a full page: `--m-bg-elev` canvas, close circle
top-right, large 「设置」 title, then a single `ListGroup` 「订阅与配额」 on top, then six groups with
the desktop names: 常规 · 模型 · 会话 · Agent 能力 · 连接 · 帮助. Rows: icon + label + chevron
(value text on the right where useful, e.g. 主题 「跟随系统」). Sub-pages push with
`PageHeader` + grouped cards. Quota page: one card per provider/account with 5 小时 / 7 天
progress bars (accent fill on `--m-surface-2` track), reset countdown, account line.

### 4.8 Tool pages (files, git, terminal, side chat, services)
`PageHeader` + content. Lists use `ListGroup`; diffs/code use the mono block style; terminal
keeps its accessory key bar (Tab, Esc, Ctrl, arrows) as 36px-high tonal capsules inside
≥44px-high targets (the visible capsules are ≥48px wide).

## 5. Acceptance rules (verify on every screen)
- No vertical/stacked-character text: short action labels, chips and statuses stay
  `whitespace-nowrap`; content, list titles, paths and errors may wrap legibly. If a short
  action does not fit, change layout or wording rather than clipping it.
- Touch targets must be ≥44×44px, including compact buttons and terminal accessory keys.
  Smaller visible discs are allowed only with an extended hit area. `IconButton size="sm"`
  retains its 44px target; both `Button` sizes and clickable `Chip`s reserve ≥44×44px layout
  bounds. Verify final rendered dimensions and spacing, including adjacent-target overlap;
  source-level minimums and the token alone do not establish a passed screen-level check.
- No content-hiding ellipsis without a way to read the full text (model names, paths, errors).
- No 「…」 inside button labels. Plain everyday Chinese labels.
- Every multi-step flow has 「上一步」 that keeps the user's choices.
- Semantic UI colours use tokens; the owned `AppMark` SVG supplies its own brand gradient.
  No raw z-index: `z-(--z-*)`.
- Verify light and dark at 390×844 with no horizontal overflow; this is an acceptance
  requirement, not a claim that final-code checks have already passed.

## 6. Behavioral acceptance and open scope

These invariants require final-code verification; documenting them does not certify a pass:

- **Approval scope:** labels must describe the actual grant sent to the host. A permanent
  grant must never be labelled as session-only, and a session-only grant must never be
  described as permanent. Unsupported scopes must not be offered as if implemented.
- **Question retry:** after a failed submission, retry resumes the current pending request,
  preserving the user's answers and current question rather than advancing or restarting an
  unrelated request. A late result for an older request must not submit or clear a newer one.
- **Auxiliary-summary recovery:** if summarizing a side chat fails or is stopped before any
  summary text arrives, release the in-progress state and restore retry/recovery controls;
  do not leave the user permanently busy or report a successful handback without text.

Settings actions that only report a save without persistence, and placeholder/static metrics,
are not evidence of completed functionality. Their scope is awaiting the user's explicit
decision. The settings and quota requirements in `MOBILE_PRD.md` remain in force; this visual
reconciliation neither removes them nor accepts reduced scope on the user's behalf.
Record actual limitations and final verification results separately; no fixed acceptance
totals or unexercised checks are claimed here.
