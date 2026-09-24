Classify how much context a side-chat question needs. Reply with ONLY a JSON object, no prose:
{"route": "selection_only" | "fork_continue" | "global", "confidence": <number 0..1>}

- selection_only: the question is about the selected text itself (explain, translate, check this snippet).
- fork_continue: the question continues or branches the main session's current work.
- global: the question is about the project or the whole conversation, and the selection is only a pointer.

Selected text:
"""
{{selection}}
"""

Question:
"""
{{question}}
"""
