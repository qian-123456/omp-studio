# Skills management

The desktop Skills tab uses a selectable list and a fixed detail panel. Selecting a skill does not change its enabled state; each list entry has one separately named enable switch. Switches continue to write global configuration and respect project overrides. Extension management remains on its own tab.

The switch help directs users to select a session, select a skill, and click **Use in current session** in its details, rather than a removed row play icon. This action also supports disabled skills without changing their enabled state: it inserts an instruction to read the skill file into the selected session's draft. A session must be selected; a missing SKILL.md or standby location cannot be invoked.

The top area keeps search, sorting, the extension entry and status filters with their counts. It does not duplicate those counts in large statistic cards. A single compact, always-visible scope line combines current-project context with the fact that switches affect new sessions across all projects. Project override and configuration-read warnings remain separate, explicit and untruncated; the list does not repeat the same global-switch explanation.

The page itself has no vertical scroll. A full-height flex layout reserves the remaining height for the skill workspace: the left list and right detail body scroll independently. The top controls and complete scope/error notices stay outside those panes; when a short window or long warning exceeds their space, this keyboard-focusable top region scrolls within a 45% height cap, leaving workspace height available. Extension content has its own remaining-height scroll region and a sticky column header. Narrow windows use horizontal scrolling inside the content region with minimum readable pane widths rather than squeezing labels into vertical text. Native acceptance must check real overflow and keyboard reachability; DOM regressions assert scroll ownership and preserved complete warnings, not browser geometry.

Usage comes from the existing 45-day usage report, not filesystem timestamps or example data. Loading and failed reads are distinct from zero triggers. Active/idle filters wait for usage data; failed usage reads cannot classify a skill as idle. Count, last-triggered and name sorting use the existing store selectors.

Each list row shows one naturally wrapping usage line beneath its real name: the report-window count (or “No triggers in the last 45 days”) followed by the last-triggered time when available. Zero in the report window never implies that the skill has never been used; an older known trigger is still shown. Loading and unavailable statistics use their own text instead of zero. The switch remains aligned on the right, without truncating the usage line or vertical text.

Source filters and path searches include every discovered location, not only the active winner. A skill with both global and project locations is counted in both source filters and remains a single list entry; all of its locations stay available in advanced details. Name and description search continue to work. When usage is unavailable under an active/idle filter, neither the list nor the detail panel selects an unverified result.

The detail panel preserves the actual description and rendered SKILL.md. Storage and installation metadata are collapsed under **Storage and installation locations (advanced)**. Every discovered location remains inspectable, including standby entries, symlink targets, provider/source and location-specific issues. Opening a location reads its own document. Deletion requires a confirmation naming its exact directory; symlink deletion keeps the target files. Deleting a real directory can affect links pointing to it, and deleting the active location can allow another location to take precedence. Same-name locations are not classified as redundant and there is no bulk cleanup.

Regression coverage: `src/features/skills/SkillsPage.test.tsx` and existing `src/features/skills/store.test.ts`.

Suggested verification (not run as part of the implementation):

- `pnpm tsc --noEmit`
- `pnpm vitest run src/features/skills/SkillsPage.test.tsx src/features/skills/store.test.ts`
- Native acceptance: selection versus switching, all filters/sorts, usage loading/error/zero, global/project override warnings, extension toggles, and each advanced location's inspection and confirmation. Do not delete real skill data during acceptance.
