Write a short title for a coding-agent conversation, based on the user's first message below.
Use the same language as the message. Describe the task, do not answer it.
No quotes, no prefix, no trailing punctuation, one line.

Reply with exactly one JSON object that matches this JSON Schema, and nothing else:
{"type":"object","required":["title"],"properties":{"title":{"type":"string","description":"at most 30 characters (Chinese) or 6 words (other languages)"}}}

First message:
"""
{{message}}
"""
