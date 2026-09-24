Summarize this coding-agent session so another agent can pick up the context. Be factual and compact (at most 12 bullet points, under 250 words), written in the same language as the conversation.

Cover: the goal, what has been done (files/components touched), current state (working / blocked / waiting for the user), open problems or decisions, and the next step.

{{#if previous_summary}}
Previous summary (update it with the new activity instead of starting from scratch):
{{previous_summary}}
{{/if}}

Session: {{label}} "{{title}}" in `{{cwd}}`

Recent transcript (oldest first, truncated):
{{transcript}}
