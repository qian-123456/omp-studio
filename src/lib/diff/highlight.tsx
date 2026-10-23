import type React from "react";

export const TOKEN_RE =
	/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|from|if|else|switch|case|default|class|type|interface|enum|async|await|try|catch|finally|for|while|do|break|continue|throw|new|this|typeof|instanceof|void|pub|fn|struct|impl|mut|use|mod|trait|match|where|crate|self|def|elif|lambda|yield|package|go|func)\b|\b\d+(?:\.\d+)?\b)/g;

export function renderHighlightedCode(
	text: string,
	kind?: "ctx" | "add" | "del" | "hunk" | "meta",
): React.ReactNode {
	if (!text) return "\u00A0";
	if (kind === "meta" || kind === "hunk") return text;
	const parts: React.ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	const re = new RegExp(TOKEN_RE.source, "g");

	while ((match = re.exec(text)) !== null) {
		if (match.index > lastIndex) {
			parts.push(text.slice(lastIndex, match.index));
		}
		const token = match[0];
		const first = token[0];
		if (
			(first === "/" && (token[1] === "/" || token[1] === "*")) ||
			first === "#"
		) {
			parts.push(
				<span key={match.index} className="italic text-neutral-500">
					{token}
				</span>,
			);
		} else if (first === '"' || first === "'" || first === "`") {
			parts.push(
				<span
					key={match.index}
					className={kind === "del" ? "text-rose-200/90" : "text-emerald-300"}
				>
					{token}
				</span>,
			);
		} else if (/^\d/.test(first)) {
			parts.push(
				<span key={match.index} className="text-amber-300">
					{token}
				</span>,
			);
		} else {
			parts.push(
				<span key={match.index} className="font-semibold text-purple-400">
					{token}
				</span>,
			);
		}
		lastIndex = re.lastIndex;
	}
	if (lastIndex < text.length) {
		parts.push(text.slice(lastIndex));
	}
	return parts;
}
