import { useTodos } from "../todos/store";

/**
 * Open "等我处理" count for the sidebar 收件箱 entry. Reads the same store the
 * inbox page renders from (started app-wide in App.tsx), so badge and list
 * never disagree.
 */
export function useInboxBadge(): number {
	return useTodos((s) => s.counts.open);
}
