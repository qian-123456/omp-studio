/**
 * Composer state: annotations (pills) per session + side-chat requests (§10). [LEAD]
 */

import { create } from "zustand";

export interface Annotation {
	id: string;
	source: "message" | "diff" | "doc" | "terminal";
	text: string;
	file?: string;
	lines?: string;
	comment?: string;
}

export interface ComposerState {
	/** By sessionId. */
	annotations: Record<string, Annotation[]>;
	addAnnotation(sessionId: string, a: Omit<Annotation, "id">): void;
	removeAnnotation(sessionId: string, id: string): void;
	clearAnnotations(sessionId: string): void;
	/** Set by any feature, consumed by SideChatPanel. */
	sideChatRequest: {
		parentSessionId: string;
		selection?: string;
	} | null;
	requestSideChat(parentSessionId: string, selection?: string): void;
	clearSideChatRequest(): void;
}

let nextId = 1;

export const useComposer = create<ComposerState>((set) => ({
	annotations: {},
	addAnnotation: (sessionId, a) =>
		set((s) => ({
			annotations: {
				...s.annotations,
				[sessionId]: [
					...(s.annotations[sessionId] ?? []),
					{ ...a, id: `ann-${nextId++}` },
				],
			},
		})),
	removeAnnotation: (sessionId, id) =>
		set((s) => ({
			annotations: {
				...s.annotations,
				[sessionId]: (s.annotations[sessionId] ?? []).filter(
					(a) => a.id !== id,
				),
			},
		})),
	clearAnnotations: (sessionId) =>
		set((s) => ({
			annotations: { ...s.annotations, [sessionId]: [] },
		})),
	sideChatRequest: null,
	requestSideChat: (parentSessionId, selection) =>
		set({ sideChatRequest: { parentSessionId, selection } }),
	clearSideChatRequest: () => set({ sideChatRequest: null }),
}));

/**
 * Render the composer text plus annotation pills as markdown quote blocks,
 * numbered [1]..[n]. Diff comments render as "文件 path 第 lines 行：comment".
 */
export function formatWithAnnotations(
	text: string,
	anns: Annotation[],
): string {
	if (anns.length === 0) return text;
	const blocks = anns.map((a, i) => {
		const n = i + 1;
		const lines: string[] = [];
		if (a.source === "diff" && a.file) {
			const where = a.lines ? ` 第 ${a.lines} 行` : "";
			lines.push(`[${n}] 文件 ${a.file}${where}：${a.comment ?? ""}`.trimEnd());
		} else {
			const where = a.file
				? ` (${a.file}${a.lines ? ` ${a.lines}` : ""})`
				: "";
			lines.push(`[${n}]${where}`.trimEnd());
		}
		if (a.text) {
			for (const line of a.text.split("\n")) {
				lines.push(`> ${line}`);
			}
		}
		if (a.comment && !(a.source === "diff" && a.file)) {
			lines.push(`批注：${a.comment}`);
		}
		return lines.join("\n");
	});
	const body = text.trimEnd();
	return body ? `${body}\n\n${blocks.join("\n\n")}` : blocks.join("\n\n");
}
