import { CalendarClock, FolderGit2, History, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { BottomSheet, Button, Chip, confirm, EmptyState, IconButton, ListGroup, MenuRow, PageHeader, PullToRefresh, Switch, toast } from "../../ui";
import type { ChipTone } from "../../ui";
import { LoadState, useLoad } from "./controls";
import { cadenceText, LIFECYCLE_LABEL, scheduleMeta } from "./schedule";
import type { Schedule } from "./schedule";

const enc = encodeURIComponent;
const ICON = { size: 22, strokeWidth: 1.75 } as const;

const lifecycleTone = (s: Schedule): ChipTone =>
	s.lifecycle === "active" ? (s.enabled ? "success" : "neutral") : s.lifecycle === "paused" ? "warn" : "neutral";

function ScheduleRow({ s, busy, onOpen, onToggle }: { s: Schedule; busy: boolean; onOpen: () => void; onToggle: () => void }) {
	const meta = scheduleMeta(s);
	return (
		<div className="m-list-row flex w-full items-stretch pl-5" data-testid="schedule-card">
			<div className="m-list-sep flex min-w-0 flex-1 items-center gap-2 pr-3">
				<button type="button" onClick={onOpen} className="min-w-0 flex-1 py-3.5 text-left active:opacity-60">
					<span className="block text-m-md font-medium break-words text-m-text">{s.name}</span>
					<span className="mt-0.5 block text-m-sm break-words text-m-text-2">{cadenceText(s.cadence)}</span>
					<span className="mt-2 flex flex-wrap items-center gap-1.5">
						<Chip tone={lifecycleTone(s)}>{LIFECYCLE_LABEL[s.lifecycle] ?? s.lifecycle}</Chip>
						{s.runMode === "worktree" && <Chip icon={<FolderGit2 size={12} />}>工作树</Chip>}
					</span>
					{meta && <span className="mt-1.5 block text-m-xs break-words text-m-text-3">{meta}</span>}
					<span className="mt-0.5 block text-m-xs break-all text-m-text-3">{s.cwd}</span>
				</button>
				<Switch
					checked={s.enabled}
					label={`启用 ${s.name}`}
					disabled={busy || s.lifecycle === "completed"}
					onChange={onToggle}
				/>
			</div>
		</div>
	);
}

export function SchedulesPage() {
	const { data, setData, error, loading, reload } = useLoad(() => api<Schedule[]>("GET", "/left/schedules"));
	const [busy, setBusy] = useState<string | null>(null);
	const [menuId, setMenuId] = useState<string | null>(null);
	const menu = data?.find((s) => s.id === menuId) ?? null;

	const run = async (s: Schedule, action: () => Promise<unknown>, ok: string, fail: string) => {
		setBusy(s.id);
		try {
			await action();
			if (ok) toast(ok, { kind: "success" });
		} catch (e) {
			toast(`${fail}：${errorMessage(e)}`, { kind: "error" });
		}
		setBusy(null);
		await reload();
	};

	const toggle = (s: Schedule) => {
		setData((d) => d && d.map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)));
		return run(s, () => api("POST", `/left/schedules/${enc(s.id)}/enabled`, { enabled: !s.enabled }), "", "操作失败");
	};
	const runNow = async (s: Schedule) => {
		setMenuId(null);
		if (!(await confirm({ title: "立即运行", message: `立即运行「${s.name}」一次？将创建新的会话执行该任务。`, confirmText: "运行" }))) return;
		await run(s, () => api("POST", `/left/schedules/${enc(s.id)}/run`), "已触发运行", "运行失败");
	};
	const del = async (s: Schedule) => {
		setMenuId(null);
		if (!(await confirm({ title: "删除定时任务", message: `删除定时任务「${s.name}」？此操作不可撤销。`, danger: true, confirmText: "删除" }))) return;
		await run(s, () => api("DELETE", `/left/schedules/${enc(s.id)}`), "已删除", "删除失败");
	};
	const go = (path: string) => {
		setMenuId(null);
		nav.push(path);
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader
				title="定时任务"
				className="bg-m-bg-elev!"
				right={<IconButton variant="filled" icon={<Plus {...ICON} />} label="新建定时任务" onClick={() => nav.push(paths.scheduleNew())} />}
			/>
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : data.length === 0 ? (
					<EmptyState
						className="min-h-[70dvh]"
						icon={<CalendarClock size={26} strokeWidth={1.75} />}
						title="还没有定时任务"
						hint="让 agent 按固定节奏自动执行提示词"
						action={
							<Button variant="primary" icon={<Plus size={18} />} onClick={() => nav.push(paths.scheduleNew())}>
								新建定时任务
							</Button>
						}
					/>
				) : (
					<div className="pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
						{error && <p className="m-selectable px-8 pb-2 text-m-sm break-words text-m-danger">刷新失败：{error}</p>}
						<ListGroup note="轻点任务查看操作，开关控制是否按计划运行">
							{data.map((s) => (
								<ScheduleRow key={s.id} s={s} busy={busy === s.id} onOpen={() => setMenuId(s.id)} onToggle={() => void toggle(s)} />
							))}
						</ListGroup>
					</div>
				)}
			</PullToRefresh>
			<BottomSheet open={!!menu} onClose={() => setMenuId(null)} title={menu?.name} subtitle={menu ? cadenceText(menu.cadence) : undefined}>
				{menu && (
					<div className="pb-2">
						<MenuRow icon={<Pencil {...ICON} />} label="编辑" onClick={() => go(paths.schedule(menu.id))} />
						<MenuRow icon={<Play {...ICON} />} label="立即运行" hint="新建一个会话执行一次" disabled={busy === menu.id} onClick={() => void runNow(menu)} />
						<MenuRow icon={<History {...ICON} />} label="运行记录" onClick={() => go(paths.scheduleRuns(menu.id))} />
						<MenuRow icon={<Trash2 {...ICON} />} label="删除" danger disabled={busy === menu.id} onClick={() => void del(menu)} />
					</div>
				)}
			</BottomSheet>
		</div>
	);
}
