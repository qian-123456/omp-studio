import { ChevronRight, Cpu } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { nav } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { BottomSheet, Button, Field, inputCls, PageHeader, Segmented, Spinner, Switch, toast } from "../../ui";
import { ModelPicker } from "../../ui/ModelPicker";
import type { PickerModel } from "../../ui/ModelPicker";
import { LoadState, Select, useLoad } from "./controls";
import {
	buildPayload,
	emptyForm,
	formFromSchedule,
	KIND_LABEL,
	modelString,
	NOTIFY_HINT,
	NOTIFY_LABEL,
	parseModel,
	RUN_MODE_HINT,
	RUN_MODE_LABEL,
	validateForm,
	WEEK,
} from "./schedule";
import type { CadenceKind, FormErrors, NotifyMode, RunMode, Schedule, ScheduleForm } from "./schedule";

interface Dir {
	path: string;
	label?: string;
}

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as CadenceKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const RUN_MODE_OPTIONS = (Object.keys(RUN_MODE_LABEL) as RunMode[]).map((k) => ({ value: k, label: RUN_MODE_LABEL[k] }));
const NOTIFY_OPTIONS = (Object.keys(NOTIFY_LABEL) as NotifyMode[]).map((k) => ({ value: k, label: NOTIFY_LABEL[k] }));

/** Inline error node; `role="alert"` so screen readers announce it. */
const err = (msg?: string): ReactNode => (msg ? <span role="alert">{msg}</span> : undefined);

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4">
			<h2 className="px-1 text-m-lg text-m-text">{title}</h2>
			{children}
		</section>
	);
}

/** Label + hint for button groups (not a `<label>`, so tapping the caption never toggles a button). */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div role="group" aria-label={label}>
			<span className="mb-1.5 block px-1 text-m-xs font-medium text-m-text-3">{label}</span>
			{children}
			{hint && <span className="mt-1.5 block px-1 text-m-xs break-words text-m-text-3">{hint}</span>}
		</div>
	);
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<div className="flex min-h-14 items-center gap-3 rounded-[14px] bg-m-surface py-1.5 pr-3 pl-4">
			<span className="min-w-0 flex-1">
				<span className="block text-m-md text-m-text">{label}</span>
				{hint && <span className="block text-m-xs break-words text-m-text-3">{hint}</span>}
			</span>
			<Switch checked={checked} label={label} onChange={onChange} />
		</div>
	);
}

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
				<div className="flex flex-col gap-9 px-4 pt-3 pb-8">
					<Section title="任务内容">
						<Field label="名称" error={err(errors.name)}>
							<input className={inputCls} value={f.name} placeholder="例如：每日晨报" onChange={(e) => set({ name: e.target.value })} />
						</Field>
						<Field label="提示词" error={err(errors.prompt)} hint="每次运行时发送给 agent">
							<textarea
								className={`${inputCls} min-h-32 resize-none leading-6`}
								rows={5}
								value={f.prompt}
								placeholder="定时发送给 agent 的提示词"
								onChange={(e) => set({ prompt: e.target.value })}
							/>
						</Field>
					</Section>

					<Section title="运行环境">
						<Field label="工作目录" error={err(errors.cwd)} hint={f.cwd || undefined}>
							<Select value={f.cwd} onChange={(v) => set({ cwd: v })}>
								{!f.cwd && <option value="">请选择目录</option>}
								{cwdOptions.map((d) => (
									<option key={d.path} value={d.path}>
										{d.label || d.path}
									</option>
								))}
							</Select>
						</Field>
						<Group label="运行方式" hint={RUN_MODE_HINT[f.runMode]}>
							<Segmented label="运行方式" value={f.runMode} options={RUN_MODE_OPTIONS} onChange={(v) => set({ runMode: v })} />
						</Group>
						<Group label="模型" hint={f.model ? undefined : "留空使用默认模型"}>
							<button
								type="button"
								onClick={openModels}
								className="flex min-h-12 w-full items-center gap-3 rounded-[14px] bg-m-surface py-3 pr-3 pl-4 text-left active:bg-m-surface-2"
							>
								<Cpu size={20} strokeWidth={1.75} className="shrink-0 text-m-text-2" />
								<span className="min-w-0 flex-1 text-m-md break-all text-m-text">
									{f.model ?? "默认模型"}
									{f.model && f.thinking && <span className="text-m-text-3"> · {f.thinking}</span>}
								</span>
								<ChevronRight size={18} className="shrink-0 text-m-text-3" aria-hidden />
							</button>
						</Group>
					</Section>

					<Section title="重复节奏">
						<Segmented label="重复方式" value={f.kind} options={KIND_OPTIONS} onChange={(v) => set({ kind: v })} />
						{f.kind === "interval" && (
							<Field label="每隔" error={err(errors.iv)}>
								<span className="flex gap-2">
									<input
										className={inputCls}
										type="number"
										inputMode="numeric"
										min={1}
										value={f.ivNum}
										onChange={(e) => set({ ivNum: e.target.value })}
									/>
									<span className="w-32 shrink-0">
										<Select label="单位" value={f.ivUnit} onChange={(v) => set({ ivUnit: v as "min" | "hour" })}>
											<option value="min">分钟</option>
											<option value="hour">小时</option>
										</Select>
									</span>
								</span>
							</Field>
						)}
						{f.kind === "daily" && (
							<>
								<Field label="时间" error={err(errors.time)}>
									<input className={inputCls} type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
								</Field>
								<Group label="星期" hint="不选则按天重复">
									<div className="flex flex-wrap justify-between gap-1">
										{WEEK.map((w, i) => {
											const on = f.weekdays.includes(i);
											return (
												<button
													key={w}
													type="button"
													aria-pressed={on}
													aria-label={`周${w}`}
													onClick={() => toggleDay(i)}
													className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill text-m-sm whitespace-nowrap transition-colors duration-(--m-dur-fast) ${
														on ? "bg-m-accent-soft font-medium text-m-accent-soft-text" : "bg-m-surface text-m-text-2"
													}`}
												>
													{w}
												</button>
											);
										})}
									</div>
								</Group>
								<Field label={f.weekdays.length ? "每隔几周" : "每隔几天"}>
									<input className={inputCls} type="number" inputMode="numeric" min={1} value={f.every} onChange={(e) => set({ every: e.target.value })} />
								</Field>
							</>
						)}
						{f.kind === "once" && (
							<Field label="运行时间" error={err(errors.at)}>
								<input className={inputCls} type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} />
							</Field>
						)}
						{f.kind === "monthly" && (
							<>
								<Field label="每月几号" error={err(errors.mday)} hint="超过当月天数时按当月最后一天运行">
									<input className={inputCls} type="number" inputMode="numeric" min={1} max={31} value={f.mday} onChange={(e) => set({ mday: e.target.value })} />
								</Field>
								<Field label="时间" error={err(errors.mTime)}>
									<input className={inputCls} type="time" value={f.mTime} onChange={(e) => set({ mTime: e.target.value })} />
								</Field>
								<Field label="每隔几个月">
									<input className={inputCls} type="number" inputMode="numeric" min={1} value={f.mEvery} onChange={(e) => set({ mEvery: e.target.value })} />
								</Field>
							</>
						)}
						{f.kind !== "once" && (
							<>
								<Field label="结束时间（可选）" error={err(errors.endAt)}>
									<input className={inputCls} type="datetime-local" value={f.endAt} onChange={(e) => set({ endAt: e.target.value })} />
								</Field>
								<Field label="最多运行次数（可选）" error={err(errors.maxRuns)}>
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
					</Section>

					<Section title="通知与开关">
						<Group label="通知" hint={NOTIFY_HINT[f.notify]}>
							<Segmented label="通知" value={f.notify} options={NOTIFY_OPTIONS} onChange={(v) => set({ notify: v })} />
						</Group>
						<div className="flex flex-col gap-2">
							<SwitchRow label="每次运行新建会话" hint="关闭则在同一个会话里继续" checked={f.fresh} onChange={(v) => set({ fresh: v })} />
							<SwitchRow label="启用" checked={f.enabled} onChange={(v) => set({ enabled: v })} />
						</div>
					</Section>
				</div>
			</div>
			<div className="shrink-0 bg-m-bg px-4 pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 12px)" }}>
				{errCount > 0 && (
					<div role="alert" className="mb-2 px-1 text-m-sm text-m-danger">
						有 {errCount} 项需要修改，请查看上方标红提示
					</div>
				)}
				{submitError && (
					<div role="alert" className="m-selectable mb-2 px-1 text-m-sm break-words text-m-danger">
						{submitError}
					</div>
				)}
				<Button variant="primary" block busy={saving} onClick={() => void save()}>
					保存
				</Button>
			</div>

			<BottomSheet
				open={modelOpen}
				onClose={() => setModelOpen(false)}
				title="选择模型"
				fullHeight
				footer={
					<div className="flex gap-2">
						<Button
							block
							className="flex-1"
							onClick={() => {
								set({ model: null, thinking: null });
								setModelOpen(false);
							}}
						>
							使用默认模型
						</Button>
						<Button variant="primary" block className="flex-1" onClick={() => setModelOpen(false)}>
							完成
						</Button>
					</div>
				}
			>
				{models ? (
					<ModelPicker
						className="h-full px-4 pb-4"
						models={models}
						value={selected}
						onChange={(m) => set({ model: modelString(m), thinking: null })}
						thinking={{ value: f.thinking, onChange: (t) => set({ thinking: t }) }}
					/>
				) : modelsError ? (
					<p className="m-selectable px-5 py-4 text-m-sm break-words text-m-danger">{modelsError}</p>
				) : (
					<div className="flex justify-center py-12 text-m-text-3">
						<Spinner size={22} />
					</div>
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
