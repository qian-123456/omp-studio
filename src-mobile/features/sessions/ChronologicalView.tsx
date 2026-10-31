import { useMemo } from "react";
import { useTree } from "./treeStore";
import { SessionRow } from "./SessionRow";
import type { SessionTree, TreeSession } from "./tree";

/** Complete visible sessions of the loaded mode, independent of tree expansion and row caps. */
export function visibleTreeSessions(tree: SessionTree): TreeSession[] {
	const sessions = new Map<string, TreeSession>();
	const add = (rows: readonly TreeSession[]) => {
		for (const session of rows) if (!session.archived) sessions.set(session.id, session);
	};
	add(tree.pinned ?? []);
	for (const group of [tree.globalGroup, ...(tree.workspaceGroups ?? [])]) {
		if (!group) continue;
		for (const subgroup of [...group.subgroups, ...group.deletedSubgroups]) add(subgroup.sessions);
	}
	for (const group of tree.unassignedGroups ?? []) add(group.sessions);
	add(tree.deletedSessions ?? []);
	return [...sessions.values()];
}

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
	const earlier = new Map<string, TreeSession[]>();

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
			const date = new Date(t);
			const label = Number.isFinite(t) && t > 0 ? `${date.getFullYear()}年${date.getMonth() + 1}月` : "日期未知";
			const month = earlier.get(label) ?? [];
			month.push(s);
			earlier.set(label, month);
		}
	}

	const groups: TimeGroup[] = [];
	if (today.length > 0) groups.push({ label: "今天", sessions: today });
	if (yesterday.length > 0) groups.push({ label: "昨天", sessions: yesterday });
	if (withinWeek.length > 0) groups.push({ label: "本周", sessions: withinWeek });
	for (const [label, sessions] of earlier) groups.push({ label, sessions });
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
	const tree = useTree((s) => s.data);
	const loading = useTree((s) => s.loading);
	const error = useTree((s) => s.error);
	const groups = useMemo(() => tree && (!tree.mode || tree.mode === mode) ? groupByTime(visibleTreeSessions(tree)) : [], [tree, mode]);

	if (!tree && loading) return <div role="status" className="px-6 py-10 text-center text-m-sm text-m-text-3">加载会话</div>;
	if (!tree && error) return <div role="alert" className="px-6 py-10 text-center text-m-sm text-m-danger">{error}</div>;

	if (groups.length === 0) {
		return <div className="px-6 py-10 text-center text-m-sm text-m-text-3">这个空间还没有会话</div>;
	}

	return (
		<div className="flex flex-col pb-2">
			{groups.map((g) => (
				<section key={g.label} aria-label={g.label}>
					<h3 className="sticky top-0 z-(--z-base) bg-m-bg/85 px-5 pt-3 pb-1 text-m-xs font-medium whitespace-nowrap text-m-text-3 backdrop-blur-xl">
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
