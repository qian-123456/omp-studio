Diagnose another coding-agent session. Explain why it is stuck, erroring, or going off track, and what to do next. Reply in Chinese.

Output format:
1. **结论** — one sentence.
2. **证据** — bullet points quoting the relevant errors/messages below.
3. **原因分析** — the most likely root cause (say how confident you are; list alternatives if unsure).
4. **建议** — concrete next steps, including an exact message the user could send to that session if useful.

You may read its full transcript (JSONL) at `{{file}}` if the excerpt below is not enough.

## Target session
- Label/title: {{label}} "{{title}}"
- Working directory: `{{cwd}}`
- Status: {{status}}

## Summary
{{summary}}

## Recent errors
{{errors}}

## Last assistant message
{{last_assistant}}
