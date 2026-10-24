import type { TranscriptItem } from "../../lib/contracts";
import { stripImageMarkers } from "./userTextChips";
import { tNow } from "../../stores/language";

/**
 * Format session transcript items into readable Markdown.
 */
export function formatSessionMarkdown(
	items: TranscriptItem[],
	sessionTitle?: string,
): string {
	const sections: string[] = [];
	if (sessionTitle) {
		sections.push(`# ${sessionTitle}`);
	}
	for (const item of items) {
		if (item.hidden) continue;
		if (item.kind === "user") {
			const text = stripImageMarkers(item.text ?? "").trim();
			sections.push(`### User\n\n${text}`);
		} else if (item.kind === "assistant") {
			const parts: string[] = [];
			if (item.thinking?.trim()) {
				parts.push(`> **${tNow("chat.export.thinkingProcess")}**\n>\n> ${item.thinking.trim().replace(/\n/g, "\n> ")}`);
			}
			if (item.text?.trim()) {
				parts.push(item.text.trim());
			}
			if (item.toolCalls && item.toolCalls.length > 0) {
				const toolParts = item.toolCalls.map((tc) => {
					const argStr =
						typeof tc.args === "string"
							? tc.args
							: JSON.stringify(tc.args, null, 2);
					const header = tc.intent
						? `**${tNow("chat.export.callTool", { name: tc.name })}** (${tc.intent})`
						: `**${tNow("chat.export.callTool", { name: tc.name })}**`;
					return `${header}:\n\`\`\`json\n${argStr}\n\`\`\``;
				});
				parts.push(toolParts.join("\n\n"));
			}
			if (parts.length > 0) {
				sections.push(`### Assistant\n\n${parts.join("\n\n")}`);
			}
		} else if (item.kind === "tool_result" || item.kind === "bash") {
			const r = item.toolResult;
			const name = r?.toolName ?? item.kind;
			const content = r?.text ?? item.text ?? "";
			if (content && typeof content === "string" && content.trim()) {
				sections.push(`### Tool: ${name}\n\n\`\`\`\n${content.trim()}\n\`\`\``);
			}
		}
	}
	return sections.join("\n\n").trim();
}
