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
  the left edge (or tap ≡) for the drawer; floating ↓ button when scrolled up. Stop stays
  available while generating; a new draft can expose Send beside it rather than replacing it.

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
「今天想做点什么？」 in `--m-fs-display`. No starter suggestions, mode tabs or username.
Above the composer, a compact current-workspace pill shows the selected directory and opens
the directory/worktree picker. Selecting a directory does not create a session. Send and
file actions revalidate the exact selected `cwd`; they must not silently substitute the
default or main project directory. Home plan mode is local draft state until sending.
Bottom: the same composer as chat (§4.4). Sending creates the session in the selected
directory and replaces the route with chat; the user's text appears optimistically.

### 4.3 Drawer (left panel with scrim)
The `--m-bg` panel is 88% of the viewport, capped at 360px, leaving a translucent
`--m-scrim` backdrop. Tap the scrim, swipe left or tap ✕ to close. A vertical list scroll
must not be mistaken for a close gesture; a cancelled horizontal swipe springs back.
- Header: 48px row with a 24px `AppMark` + medium-weight 「OMP」 brand in `--m-fs-md`;
  plain search and close icons each retain an independent ≥44×44px target.
- 「发起新对话」 full-width, 44px-high `--m-surface` button with softly rounded corners
  (pencil icon, left aligned), followed by side-by-side secondary shortcuts 「定时任务」
  and 「灵感收件箱」 in that order, each with a ≥44×44px target. Search lives in the header.
  Skills is not a drawer item; use 设置 ▸ Agent 能力 ▸ 技能与命令.
- Space switcher (代码 / 通用对话 / 学习…) is transparent with a chevron and a ≥44×44px
  target, next to the shared `Segmented` 「按项目 | 按时间」 with compact padding and a
  shadowless selected pill; each segment retains a ≥44×44px target. Busy/count cues come
  from the complete current-space
  tree, deduplicated across pinned and grouped rows; do not invent counts for other spaces.
- 按项目 follows the desktop hierarchy: coloured folder icon, modest medium-weight project heading, collapsed
  status bubbles and an independent ≥44px `+` target. Worktree/branch subgroups are indented,
  use a monospace title and a quiet 「主目录」 or 「已清理」 badge. Avoid raw multiline path
  clutter in headers, but retain a way to inspect the full path.
- Reuse registered worktrees by `workspaceId` and their actual `cwd`, including paths outside
  the project directory. New worktrees are created and registered on desktop; explain this
  limitation rather than implying mobile creates one or falling back to the main directory.
- Session rows are 44px high and use the desktop-style `--m-tree-line` trunk, `├─` branch ticks and a rounded
  `╰─` final elbow beneath an open project/subgroup. The selected row is a rounded highlight;
  side chats/forks have distinct icons, with an unread dot and tabular relative time.
  A faded single-line title must still be available in full through the long-press actions.
  Right swipe toggles the real read/unread state. Left swipe only reveals an archive/unarchive
  button, even for a full swipe; only tapping that button changes archive state. Tapping the
  revealed row or swiping it right closes the action without opening the session or changing
  read state. Drafts do not offer swipe actions. Expansion uses quiet hairline 「+ 展开 N 条」 / 「收起」 dividers with reduced
  vertical spacing, alongside compact project/subgroup gaps; all interactive targets remain ≥44×44px.
- 按时间 groups recent sessions by date, then older sessions by 「YYYY年M月」 with sticky,
  softly blurred headers rather than one unbounded 「更早」 group.
- Bottom bar (pinned, `--m-bg` with top hairline and safe-area padding): 收件箱 (bell +
  count badge) · 订阅与配额 · 设置 — three equal tappable cells with short nonwrapping labels.

### 4.4 Composer
Floating capsule at the bottom, 16px side margin, `--m-composer-bg` with
`--m-composer-shadow`, radius 28, min height 56. Single-line: `[+] placeholder [🎤] [send]`.
Actual textarea height determines multiline layout; the capsule grows up to 40% of the
viewport and buttons remain on the bottom row.
- `+` opens the ChatGPT-style **actions sheet** with file, 「电脑端选中项」, sketch,
  native 「拍照」 (`capture="environment"`) and 「相册」 image inputs, plus project,
  goal and planning actions. Camera/gallery use the normal upload and attachment flow.
- Mic: tap to record (button turns into a red pulsing stop); transcript is inserted at the
  caret, never auto-sent. Hardware keyboard Enter and Cmd/Ctrl+Enter can send without a
  hover-capable pointer; composition and intentional line breaks remain distinct.
- Send: 40px visible circle inside a ≥44px target, `--m-accent-soft`; disabled when empty.
  While generating, Stop remains visible and clickable. A nonempty draft or attachments
  exposes Send beside Stop, preserving the follow-up/interruption choice.
- Status row above the capsule: a stable, single-line horizontally scrollable strip contains
  the working-directory selector, optional 「规划模式 ✕」 chip and compact
  「后续提问」 / 「插话打断」 control. Plan mode never replaces the directory selector.
  Context usage stays pinned on the right and opens usage/compaction controls. Starting or
  ending generation must not add/remove a separate full-height mode row.

### 4.5 Thread
- User message: right-aligned capsule bubble, `--m-bubble-user-bg`, radius 24 (single line =
  full capsule), padding 12×18, max width 85%, 17px.
- Assistant: full-width plain text, `--m-fs-body`, no avatar, 20px gutter. Loading earlier
  turns compensates the scroll-height change to preserve the reading position. The floating
  ↓ control carries an unread/streaming cue when new content arrives away from the bottom.
- Thinking: one quiet line 「已思考 12 秒 ›」; while running 「思考中」. Expanded reasoning
  uses Markdown in a height-limited scrolling region with sticky collapse/copy controls.
- Tools: consecutive calls collapse into 「已运行 6 个步骤 · 57 秒 ›」. Each expanded
  tool row has a disclosure arrow; structured/code output uses `CodeBlock`, results have
  Copy, and full errors remain readable rather than clipped.
- Turn footer: plain copy/retry/more actions plus quiet time/token stats. The message actions
  sheet includes 「引用回复」 to insert a quotation into the composer without sending it.
- Plan, question and approval cards use 24-radius `--m-surface` cards and capsule actions.
  Questions show progress and explicit single/multiple-choice hints; focused answers scroll
  into view above the keyboard. Long-path approval actions stack rather than clip labels.
  「修改计划」 prepares a revision draft; successful execution exposes 「查看计划」 and an
  executing state, not another implicit model call.
- Subagent summary occupies its own sticky row below the top bar, never overlays prose.
  The tree has compact 14px indentation and independent subtree-collapse controls. Detail
  updates reuse shared SSE, incremental `fromByte` reads, single-flight plus one trailing
  refresh, and approximately 600ms coalescing. A 5s fallback runs only while mounted,
  visible and running. Hide/unmount clears timers/listeners and aborts owned requests;
  resuming retains the cursor. Initial/reset reads may still read the full transcript:
  this is bounded request work, not zero overhead or a guarantee of no full-file reads.
  「停止当前回合」 requires confirmation and stops the parent session's current turn,
  not just the displayed child; a rejected stop remains an error, not a success notice.

### 4.6 Sheets and pickers
- Model + thinking sheet: catalog thinking levels appear above provider/model rows; search
  flattens results and can be cleared. The provider-back control stays in the sticky header.
- The tools menu and shared workspace bar expose 文件, Git, 终端, 辅助对话 and 服务.
  「计划」 is conditional on the approved snapshot's `status === "executing"`, independent
  of whether planning mode is enabled. An already-open plan page retains its own entry
  when execution completes; ordinary chat/tools must not show a plan entry merely because
  plan mode is on. Opening the page is a read-only action, not approval or execution.
- Action sheets use `MenuRow`s, with destructive actions in danger colour at the end.

### 4.7 Settings (`/settings`)
Gemini settings sheet layout rendered as a full page: `--m-bg-elev` canvas, close circle
top-right, large 「设置」 title, then 「订阅与配额」 and the six desktop-named groups:
常规 · 模型 · 会话 · Agent 能力 · 连接 · 帮助. Rows use icon + label + chevron and optional
current value; sub-pages push with `PageHeader` + grouped cards.
- Agent 能力 ▸ 技能与命令 opens `/skills`, backed by the real skill/extension catalog,
  content and toggle APIs, not a fixed six-item sheet. Row/detail opening and the toggle
  reserve separate targets, with no nested buttons. Catalog entries are not proof of what
  an individual session has loaded.
- Mount only the selected settings sheet. Closing keeps that instance with `open=false`
  for its exit/local draft; selecting another replaces it rather than keeping all sheets
  mounted. Auxiliary-model settings go directly to cwd-scoped roles. Thinking is an inline
  explanation with the existing persisted hide-thinking control, not a dead-end sheet.
- MCP configuration, agent definitions, rule files and memory are explicitly desktop-managed
  read-only notices: no corresponding mobile settings read APIs exist. Do not display fake
  current lists, editable examples, creates/toggles or save notices. Session subagent history
  is not agent definitions; the skills catalog is not a loaded-memory/session snapshot.
- Numeric settings debounce for 350ms per key and coalesce to the latest trailing value;
  boolean/enum changes save immediately through the same per-key serialization. Blur,
  leaving the group and page teardown flush pending numbers. A failed latest save restores
  the last successfully persisted value and shows the full error, not a false success.
- Role model-only/thinking-only edits and reversible provider-URL-only edits save directly
  with a guarded Undo action. Compound role changes, inheritance restoration, typed provider
  keys and URLs without a known inverse retain confirmation. Undo rereads the actual value
  and is invalidated by newer changes; it must not overwrite intervening configuration.
- Fallback-chain Save stays above the safe bottom with 12px extra padding; reorder actions
  reserve independent ≥44px bounds rather than overlapping adjacent controls.
- Quota uses provider/account cards with real progress, reset countdown and account
  information. A failed refresh retains the previous real data and timestamp with an
  explicit stale notice, full error and Retry; unknown metrics are never invented.

### 4.8 Tool pages (files, git, terminal, side chat, services, plan)
`PageHeader` + shared `WorkspacePanelBar` + content. The bar switches between
对话 · 文件 · Git · 终端 · 辅助 · 服务, with the conditional plan entry defined in §4.6.
It remains available in Git diff and side-chat thread views using the parent session ID.
Loaded content remains visible during refresh or refresh errors; changing resources clears
stale data and cancels the old request. Lists use `ListGroup`; code/diffs use shared renderers.
- Files render source directly with `CodeBlock`, not generated Markdown fences.
- Git pins its commit field/actions outside the scroller above the safe bottom. Commit
  submits only currently staged changes; per-file actions and all-visible pending/staged
  actions state their scope and count explicitly. Errors remain visible.
- Terminal uses real page-owned PTY tabs (maximum four). Switching preserves each mounted
  terminal, stream and input; confirmed close removes only the target after server success.
  Leaving the page closes owned instances. The keyboard-aware accessory bar is fixed above
  `--m-kb` with safe-area padding and reserved content space. Tab/Esc/Ctrl/arrows, clipboard
  Paste, display-only Clear, font size 11–22 with fit/resize, and Hide Keyboard retain ≥44px
  targets; clearing the display must not secretly send a shell command.
- Side chat reuses `ComposerCapsule`, including voice insertion and real uploads. First-send
  uploads belong to the parent; native images use the additive `imagePaths` create field.
  Later uploads/prompts belong to the child, with native image blocks and follow-up mode
  while working. Generic files keep real uploaded-path tokens. Only successful delivery
  clears the draft/attachments; failures retain retry/remove controls and cancel/revoke
  owned upload resources on teardown. No send modifies the main chat's draft/store.
  The summary/hand-back entry lives in the header's right slot, not a duplicate bottom CTA.

### 4.9 Inbox, search and new-session picker
- Inbox read actions use right swipe or compact overflow rather than a wide inline button.
  Todo details preview at most three lines with 「展开全部」; actions have clear primary
  and secondary slots instead of competing equal-weight controls.
- Search keeps the last successful result while a new query loads in the same space/archive
  scope. Results are flat session rows with keyword highlighting, not hidden in collapsed
  folders. Clear hides results immediately; query changes and unmount cancel obsolete work.
- New-session selection searches directory names/paths, uses boundary-aware `~/...`
  abbreviation from the backend home directory, and keeps full paths accessible.
  「直接创建」 is primary; 「选择模型」 is the secondary path.

### 4.10 Media, code and sketch controls
- Image viewer: double tap toggles 1×/2.5× zoom; a delayed single tap toggles close-button
  chrome, not dismissal. Pinch/pan/cancel suppress tap actions. Downward dismissal requires
  a single pointer remaining at 1× throughout the gesture.
- Code/diff line numbers are opt-in; word wrap defaults off (an explicit code `wrap` prop
  remains respected). Beyond 24 logical lines, the initial preview shows 24 with expand/
  collapse controls and full raw Copy. Expanded content over 400 lines retains grouped
  offscreen-rendering protection and continuous numbering to limit offscreen rendering work.
- Mermaid source has one code header, not nested duplicate controls. Wide diagrams scroll
  horizontally at legible native scale and can open in the image viewer.
- Both sketch entry points preserve logical strokes across viewport/orientation resize,
  replay ink/eraser compositing, support undo and expose an eraser toggle. Tool pills scroll
  horizontally without wrapping short labels. Resize or cancelled interaction must not
  silently discard existing strokes or emit a cancelled export.

### 4.11 Desktop phone-pairing panel
The desktop `MobilePanel` is connection-first, using lightweight settings rows rather
than stacked shadow cards. One LAN / remote switch controls the visible area; remote
shows IPv6 / Cloudflare Tunnel as two direct choices, not a dropdown or another heading
hierarchy. Switching views never changes connectivity and preserves mounted drafts.
Each compact connection row names its transport, followed by a secondary status chip and
adjacent actions; a status such as “Stopped” never stands alone as the row's subject.
Addresses have adjacent copy controls. Detailed
ports, DDNS, certificate and tunnel configuration stay inside native connection-settings
disclosures. Desktop controls use shared settings sizes, not the phone's 44px minimum.
QR codes are generated only by explicit action and remain with the generating transport.
The white-backed code, expiry, short scanning instructions and full wrapping link appear
together; narrow layouts stack naturally. Expired codes cannot expose a working link.
LAN/IPv6 port edits require explicit Save or Save & Restart; persistence must succeed
before stopping/restarting a running service. Explanatory text appears only when needed;
errors and important warnings remain complete, while short action labels never wrap.

Paired-device rows follow connection controls. Their default view shows a compact name
and last-access time, with rename and individual removal. A native Details disclosure
holds pairing time and the complete browser information; raw agents are never repeated
as row titles. Default names are short platform hints such as iPhone or Android. Known
legacy autogenerated agent names are normalized at both DTO read paths, including
databases already upgraded to v24; custom names and stored credentials stay intact.
Browser information is not a hardware fingerprint: identical agents/names do not merge
authorizations. Phone pairing completes automatically; a nonblocking success notice
offers optional editing, also available later in connection settings. No extra
confirmation is required to keep the default.

Removal requires confirmation and defaults to keeping computer work running. It closes
the removed authorization's live data streams and denies subsequent requests without
killing a retained terminal. Exact owned terminal work can be explicitly selected for
stopping. Session turns are shown with guidance to stop them in the session itself:
upstream has no atomic task-instance abort, so the application does not risk stopping a
newer task. Old or mixed-origin session work is not attributed by guesswork. Global
removal remains a lower-emphasis bordered action. Browser fixtures verify component
behavior, not final native rendering; actual desktop acceptance is a separate check.

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

## 6. Behavioral and verification boundaries

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

The approved settings boundary is real reads/persistence where supported and explicitly
desktop-managed read-only views otherwise. Static current-configuration examples, fake save
notices and placeholder metrics are not substitutes for working APIs. The settings and quota
requirements in `MOBILE_PRD.md` remain in force; unsupported capabilities must be explained,
not silently presented as completed functionality.

Keep runtime regression evidence separate from visual acceptance. Browser coverage reported
for this reconciliation is limited to the phase-1 dark-scheme smoke; later HTTP/ReactDOM
lifecycle checks do not establish mobile geometry, native keyboard/selection, canvas raster
pixels, rendering performance or a full light/dark screen pass. The 390×844 checks in §5
remain acceptance requirements. Record actual exercised checks and limitations separately;
overlapping phase test suites must not be summed into an invented total.
