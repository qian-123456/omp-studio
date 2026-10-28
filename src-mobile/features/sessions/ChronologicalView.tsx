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
	const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
	const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7).getTime();

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
	if (withinWeek.length > 0) groups.push({ label: "本周", sessions: withinWeek });
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
		return <div className="px-6 py-10 text-center text-m-sm text-m-text-3">这个空间还没有会话</div>;
	}

	return (
		<div className="flex flex-col pb-2">
			{groups.map((g) => (
				<section key={g.label} aria-label={g.label}>
					<h3 className="sticky top-0 z-(--z-base) bg-m-bg px-5 pt-5 pb-1.5 text-m-xs font-medium whitespace-nowrap text-m-text-3">
						{g.label}
					</h3>
					{g.sessions.map((s) => (
						<SessionRow key={s.id} s={s} current={s.id === curId} onMore={onMore} onOpen={onOpen} />
					))}
				</section>
			))}
		</div>
	);
}
