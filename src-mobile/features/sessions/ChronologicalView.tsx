import { useMemo } from "react";
import { useSessions } from "../../core/stores/sessions";
import { useTree } from "./treeStore";
import { SessionRow } from "./SessionRow";
import type { TreeSession } from "./tree";

interface TimeGroup {
	label: string;
	sessions: TreeSession[];
}

export function groupByTime(sessions: readonly TreeSession[]): TimeGroup[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - 86400000;
	const weekStart = todayStart - 6 * 86400000;

	const today: TreeSession[] = [];
	const yesterday: TreeSession[] = [];
	const withinWeek: TreeSession[] = [];
	const earlier: TreeSession[] = [];

	const sorted = [...sessions].sort((a, b) => {
		const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
		const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
		return tb - ta;
	});

	for (const s of sorted) {
		if (s.archived) continue;
		const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
		if (t >= todayStart) {
			today.push(s);
		} else if (t >= yesterdayStart) {
			yesterday.push(s);
		} else if (t >= weekStart) {
			withinWeek.push(s);
		} else {
			earlier.push(s);
		}
	}

	const groups: TimeGroup[] = [];
	if (today.length > 0) groups.push({ label: "今天", sessions: today });
	if (yesterday.length > 0) groups.push({ label: "昨天", sessions: yesterday });
	if (withinWeek.length > 0) groups.push({ label: "7 天内", sessions: withinWeek });
	if (earlier.length > 0) groups.push({ label: "更早", sessions: earlier });
	return groups;
}

export function ChronologicalView({
	onMore,
	onOpen,
	curId,
}: {
	onMore: (s: TreeSession) => void;
	onOpen?: (s: TreeSession) => void;
	curId?: string | null;
}) {
	const mode = useTree((s) => s.mode);
	const list = useSessions((s) => s.list);

	const groups = useMemo(() => {
		const filtered = list.filter((s) => (s.mode ?? "code") === mode && !s.archived);
		return groupByTime(filtered as TreeSession[]);
	}, [list, mode]);

	if (groups.length === 0) {
		return <div className="p-8 text-center text-m-sm text-m-text-3">暂无会话</div>;
	}

	return (
		<div className="flex flex-col">
			{groups.map((g) => (
				<div key={g.label}>
					<div className="sticky top-0 z-1 border-b border-m-border bg-m-bg-elev/95 px-4 py-1.5 text-m-xs font-semibold text-m-text-3 backdrop-blur-sm">
						{g.label} ({g.sessions.length})
					</div>
					{g.sessions.map((s) => (
						<SessionRow
							key={s.id}
							s={s}
							current={s.id === curId}
							onMore={onMore}
							onOpen={onOpen}
						/>
					))}
				</div>
			))}
		</div>
	);
}
