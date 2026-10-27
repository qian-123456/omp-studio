import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ChatController, ChatState } from "./chatStore";
import type { RequestStat } from "./lib/requestStats";

export interface MessageTarget {
	/** "user" or "assistant" message. */
	role: "user" | "assistant";
	text: string;
	/** Transcript entry id (fork cut point for assistant rows). */
	entryId: string | null;
	/** Last assistant answer of the whole transcript: eligible for retry/regenerate. */
	canRetry: boolean;
}

export interface ChatUi {
	controller: ChatController;
	openActions: (t: MessageTarget) => void;
	openStat: (s: RequestStat) => void;
}

export const ChatCtx = createContext<ChatUi | null>(null);

export function useChatUi(): ChatUi {
	const v = useContext(ChatCtx);
	if (!v) throw new Error("ChatCtx missing");
	return v;
}

export function useChat<T>(selector: (s: ChatState) => T): T {
	return useStore(useChatUi().controller.store, selector);
}
