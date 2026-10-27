import { Cpu } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { nav } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { BottomSheet, PageHeader, toast } from "../../ui";
import { ModelPicker } from "../../ui/ModelPicker";
import type { PickerModel } from "../../ui/ModelPicker";
import { btnCls, btnPrimaryCls, Field, inputCls, LoadState, Segmented, Switch, useLoad } from "./controls";
import {
	buildPayload,
	emptyForm,
	formFromSchedule,
	KIND_LABEL,
	modelString,
	NOTIFY_LABEL,
	parseModel,
	RUN_MODE_LABEL,
	validateForm,
	WEEK,
} from "./schedule";
import type { CadenceKind, FormErrors, NotifyMode, RunMode, Schedule, ScheduleForm } from "./schedule";

interface Dir {
	path: string;
	label?: string;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4 rounded-m-lg border border-m-border bg-m-surface p-4">
			<h2 className="flex items-center gap-2 text-m-md font-semibold">
				<span className="flex h-6 w-6 items-center justify-center rounded-m-pill bg-m-accent text-m-xs text-m-accent-text">{n}</span>
				{title}
			</h2>
			{children}
		</section>
	);
}

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as CadenceKind[]).map((k) => [k, KIND_LABEL[k]] as const);
const RUN_MODE_OPTIONS = (Object.keys(RUN_MODE_LABEL) as RunMode[]).map((k) => [k, RUN_MODE_LABEL[k]] as const);
const NOTIFY_OPTIONS = (Object.keys(NOTIFY_LABEL) as NotifyMode[]).map((k) => [k, NOTIFY_LABEL[k]] as const);

interface Loaded {
	dirs: Dir[];
	existing: Schedule | null;
}

export function ScheduleFormPage({ id }: { id?: string }) {
	const { data, error, loading, reload } = useLoad<Loaded>(async () => {
		const [{ dirs }, list] = await Promise.all([
			api<{ dirs: Dir[] }>("GET", "/left/dirs"),
			id ? api<Schedule[]>("GET", "/left/schedules") : Promise.resolve<Schedule[]>([]),
		]);
		const existing = id ? (list.find((s) => s.id === id) ?? null) : null;
		if (id && !existing) throw new Error("任务不存在");
		return { dirs: dirs ?? [], existing };
	}, [id]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title={id ? "编辑定时任务" : "新建定时任务"} />
			{data ? (
				<Form key={data.existing?.id ?? "new"} dirs={data.dirs} existing={data.existing} />
			) : (
				<LoadState loading={loading} error={error} onRetry={reload} />
			)}
		</div>
	);
}

function Form({ dirs, existing }: { dirs: Dir[]; existing: Schedule | null }) {
	const [f, setF] = useState<ScheduleForm>(() => (existing ? formFromSchedule(existing) : emptyForm(dirs[0]?.path ?? "")));
	const [errors, setErrors] = useState<FormErrors>({});
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const [models, setModels] = useState<PickerModel[] | null>(null);
	const [modelsError, setModelsError] = useState<string | null>(null);

	const set = (patch: Partial<ScheduleForm>) => {
		setF((p) => ({ ...p, ...patch }));
		setErrors((e) => {
			if (!Object.keys(e).length) return e;
			const next = { ...e };
			for (const k of Object.keys(patch)) delete next[k as keyof FormErrors];
			if ("ivNum" in patch || "ivUnit" in patch) delete next.iv;
			return next;
		});
	};

	// A stored cwd that is no longer listed must stay selectable, or saving would silently change it.
	const cwdOptions: Dir[] = f.cwd && !dirs.some((d) => d.path === f.cwd) ? [{ path: f.cwd }, ...dirs] : dirs;

	const openModels = () => {
		setModelOpen(true);
		if (models) return;
		setModelsError(null);
		api<{ models: PickerModel[] }>("GET", "/left/roles")
			.then((r) => setModels(r.models ?? []))
			.catch((e) => setModelsError(errorMessage(e, "模型列表加载失败")));
	};

	const save = async () => {
		const errs = validateForm(f);
		setErrors(errs);
		setSubmitError(null);
		if (Object.keys(errs).length) return;
		setSaving(true);
		try {
			const body = buildPayload(f, existing);
			if (existing) await api("PUT", `/left/schedules/${encodeURIComponent(existing.id)}`, body);
			else await api("POST", "/left/schedules", body);
			toast("已保存", { kind: "success" });
			nav.back();
		} catch (e) {
			setSubmitError(`保存失败：${errorMessage(e)}`);
			setSaving(false);
		}
	};

	const errCount = Object.keys(errors).length;
	const selected = models ? parseModel(f.model, models) : null;
	const toggleDay = (d: number) =>
		set({ weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d] });

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="flex flex-col gap-4 p-4">
					<Step n={1} title="任务内容">
						<Field label="名称" error={errors.name}>
							<input className={inputCls} value={f.name} placeholder="例如：每日晨报" onChange={(e) => set({ name: e.target.value })} />
						</Field>
						<Field label="提示词" error={errors.prompt} hint="每次运行时发送给 agent">
							<textarea
								className={`${inputCls} min-h-28 py-2`}
								rows={5}
								value={f.prompt}
								placeholder="定时发送给 agent 的提示词"
								onChange={(e) => set({ prompt: e.target.value })}
							/>
						</Field>
					</Step>

					<Step n={2} title="运行环境">
						<Field label="工作目录" error={errors.cwd}>
							<select className={inputCls} value={f.cwd} onChange={(e) => set({ cwd: e.target.value })}>
								{!f.cwd && <option value="">请选择目录</option>}
								{cwdOptions.map((d) => (
									<option key={d.path} value={d.path}>
										{d.label || d.path}
									</option>
								))}
							</select>
						</Field>
						<Field label="运行方式">
							<Segmented label="运行方式" value={f.runMode} options={RUN_MODE_OPTIONS} onChange={(v) => set({ runMode: v })} />
						</Field>
						<Field label="模型" hint={f.model ? undefined : "留空使用默认模型"}>
							<button type="button" onClick={openModels} className={`${btnCls} justify-start`}>
								<Cpu size={16} className="shrink-0" />
								<span className="min-w-0 break-all text-left">
									{f.model ? `${f.model}${f.thinking ? ` · ${f.thinking}` : ""}` : "默认模型"}
								</span>
							</button>
						</Field>
					</Step>

					<Step n={3} title="重复节奏">
						<Segmented label="重复方式" value={f.kind} options={KIND_OPTIONS} onChange={(v) => set({ kind: v })} />
						{f.kind === "interval" && (
							<Field label="每隔" error={errors.iv}>
								<div className="flex gap-2">
									<input
										className={inputCls}
										type="number"
										inputMode="numeric"
										min={1}
										value={f.ivNum}
										onChange={(e) => set({ ivNum: e.target.value })}
									/>
									<select className={`${inputCls} w-28 shrink-0`} value={f.ivUnit} onChange={(e) => set({ ivUnit: e.target.value as "min" | "hour" })}>
										<option value="min">分钟</option>
										<option value="hour">小时</option>
									</select>
								</div>
							</Field>
						)}
						{f.kind === "daily" && (
							<>
								<Field label="时间" error={errors.time}>
									<input className={inputCls} type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
								</Field>
								<Field label="星期" hint="不选 = 按天重复">
									<div className="flex flex-wrap gap-2">
										{WEEK.map((w, i) => (
											<button
												key={w}
												type="button"
												aria-pressed={f.weekdays.includes(i)}
												onClick={() => toggleDay(i)}
												className={`min-h-11 min-w-11 whitespace-nowrap rounded-m-pill border px-3 text-m-sm ${
													f.weekdays.includes(i) ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border bg-m-bg text-m-text-2"
												}`}
											>
												周{w}
											</button>
										))}
									</div>
								</Field>
								<Field label={f.weekdays.length ? "每隔几周" : "每隔几天"}>
									<input className={inputCls} type="number" inputMode="numeric" min={1} value={f.every} onChange={(e) => set({ every: e.target.value })} />
								</Field>
							</>
						)}
						{f.kind === "once" && (
							<Field label="运行时间" error={errors.at}>
								<input className={inputCls} type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} />
							</Field>
						)}
						{f.kind === "monthly" && (
							<>
								<Field label="每月几号" error={errors.mday} hint="超过当月天数时按当月最后一天运行">
									<input className={inputCls} type="number" inputMode="numeric" min={1} max={31} value={f.mday} onChange={(e) => set({ mday: e.target.value })} />
								</Field>
								<Field label="时间" error={errors.mTime}>
									<input className={inputCls} type="time" value={f.mTime} onChange={(e) => set({ mTime: e.target.value })} />
								</Field>
								<Field label="每隔几个月">
									<input className={inputCls} type="number" inputMode="numeric" min={1} value={f.mEvery} onChange={(e) => set({ mEvery: e.target.value })} />
								</Field>
							</>
						)}
						{f.kind !== "once" && (
							<>
								<Field label="结束时间（可选）" error={errors.endAt}>
									<input className={inputCls} type="datetime-local" value={f.endAt} onChange={(e) => set({ endAt: e.target.value })} />
								</Field>
								<Field label="最多运行次数（可选）" error={errors.maxRuns}>
									<input
										className={inputCls}
										type="number"
										inputMode="numeric"
										min={1}
										value={f.maxRuns}
										placeholder="不限"
										onChange={(e) => set({ maxRuns: e.target.value })}
									/>
								</Field>
							</>
						)}
					</Step>

					<Step n={4} title="通知与开关">
						<Field label="通知">
							<Segmented label="通知" value={f.notify} options={NOTIFY_OPTIONS} onChange={(v) => set({ notify: v })} />
						</Field>
						<div className="flex items-center justify-between gap-3">
							<span className="text-m-md">每次运行新建会话</span>
							<Switch checked={f.fresh} label="每次运行新建会话" onChange={(v) => set({ fresh: v })} />
						</div>
						<div className="flex items-center justify-between gap-3">
							<span className="text-m-md">启用</span>
							<Switch checked={f.enabled} label="启用" onChange={(v) => set({ enabled: v })} />
						</div>
					</Step>
				</div>
			</div>
			<div
				className="shrink-0 border-t border-m-border bg-m-bg px-4 pt-3"
				style={{ paddingBottom: "calc(var(--m-safe-bottom) + 12px)" }}
			>
				{errCount > 0 && (
					<div role="alert" className="mb-2 text-m-sm text-m-danger">
						有 {errCount} 项需要修改，请查看上方标红提示
					</div>
				)}
				{submitError && (
					<div role="alert" className="mb-2 break-words text-m-sm text-m-danger">
						{submitError}
					</div>
				)}
				<button type="button" className={`${btnPrimaryCls} w-full`} disabled={saving} onClick={() => void save()}>
					{saving ? "保存中" : "保存"}
				</button>
			</div>

			<BottomSheet
				open={modelOpen}
				onClose={() => setModelOpen(false)}
				title="选择模型"
				fullHeight
				footer={
					<div className="flex gap-2">
						<button type="button" className={`${btnCls} flex-1`} onClick={() => { set({ model: null, thinking: null }); setModelOpen(false); }}>
							使用默认模型
						</button>
						<button type="button" className={`${btnPrimaryCls} flex-1`} onClick={() => setModelOpen(false)}>
							完成
						</button>
					</div>
				}
			>
				{models ? (
					<ModelPicker
						className="h-full p-4"
						models={models}
						value={selected}
						onChange={(m) => set({ model: modelString(m), thinking: null })}
						thinking={{ value: f.thinking, onChange: (t) => set({ thinking: t }) }}
					/>
				) : modelsError ? (
					<div className="p-4 text-m-sm text-m-danger">{modelsError}</div>
				) : (
					<div className="p-4 text-m-text-3">加载模型列表</div>
				)}
			</BottomSheet>
		</>
	);
}

export function ScheduleNewPage() {
	return <ScheduleFormPage />;
}

export function ScheduleDetailPage({ route }: PageProps) {
	return <ScheduleFormPage id={route.params.id} />;
}
