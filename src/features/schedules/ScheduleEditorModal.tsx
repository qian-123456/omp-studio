import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Z_LAYER } from "../../components/FloatingLayer";
import { ModelSelect } from "../../components/ModelSelect";
import type {
	Schedule,
	ScheduleCadence,
	ScheduleDraft,
	ScheduleRunMode,
} from "../../lib/contracts";
import { useEscapeKey } from "../../lib/hooks";
import { gitRepoRoot, listModels } from "../../lib/ipc";
import { type ModelOption, parseModels, toModelKey } from "../../lib/models";
import { useSessions } from "../../stores/sessions";

interface Props {
	isOpen: boolean;
	onClose: () => void;
	editingSchedule: Schedule | null;
	template?: Partial<ScheduleDraft> | null;
	onSave: (draft: ScheduleDraft) => Promise<unknown>;
}

const WEEKDAYS = [
	{ id: 1, label: "周一" },
	{ id: 2, label: "周二" },
	{ id: 3, label: "周三" },
	{ id: 4, label: "周四" },
	{ id: 5, label: "周五" },
	{ id: 6, label: "周六" },
	{ id: 0, label: "周日" },
];

export function ScheduleEditorModal({
	isOpen,
	onClose,
	editingSchedule,
	template,
	onSave,
}: Props) {
	const workspaces = useSessions((s) => s.workspaces);
	const [name, setName] = useState("");
	const [prompt, setPrompt] = useState("");
	const [cwd, setCwd] = useState("");
	const [runMode, setRunMode] = useState<ScheduleRunMode>("local");
	const [isGitRepo, setIsGitRepo] = useState(false);

	// Cadence state
	const [cadenceType, setCadenceType] = useState<"daily" | "interval">("daily");
	const [dailyTime, setDailyTime] = useState("09:00");
	const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
	const [intervalMinutes, setIntervalMinutes] = useState(60);

	// Model & approval
	const [model, setModel] = useState<string | null>(null);
	const [approvalMode, setApprovalMode] = useState<string>("write");
	const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
	const [saving, setSaving] = useState(false);

	useEscapeKey(onClose);

	// Load available models
	useEffect(() => {
		let active = true;
		listModels()
			.then((raw) => {
				if (active) setAvailableModels(parseModels(raw));
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	// Initialize form on open / schedule change
	useEffect(() => {
		if (!isOpen) return;

		if (editingSchedule) {
			setName(editingSchedule.name);
			setPrompt(editingSchedule.prompt);
			setCwd(editingSchedule.cwd);
			setRunMode(editingSchedule.runMode);
			setModel(editingSchedule.model);
			setApprovalMode(editingSchedule.approvalMode || "write");

			if (editingSchedule.cadence.kind === "interval") {
				setCadenceType("interval");
				setIntervalMinutes(editingSchedule.cadence.minutes);
			} else {
				setCadenceType("daily");
				setDailyTime(editingSchedule.cadence.time || "09:00");
				setWeekdays(editingSchedule.cadence.weekdays ?? []);
			}
		} else {
			// New or template
			setName(template?.name ?? "");
			setPrompt(template?.prompt ?? "");
			const defaultCwd =
				template?.cwd ?? workspaces.find((w) => w.kind === "project")?.path ?? "";
			setCwd(defaultCwd);
			setRunMode(template?.runMode ?? "local");
			setModel(template?.model ?? null);
			setApprovalMode(template?.approvalMode ?? "write");

			if (template?.cadence?.kind === "interval") {
				setCadenceType("interval");
				setIntervalMinutes(template.cadence.minutes);
			} else if (template?.cadence?.kind === "daily") {
				setCadenceType("daily");
				setDailyTime(template.cadence.time || "09:00");
				setWeekdays(template.cadence.weekdays ?? [1, 2, 3, 4, 5]);
			} else {
				setCadenceType("daily");
				setDailyTime("09:00");
				setWeekdays([1, 2, 3, 4, 5]);
				setIntervalMinutes(60);
			}
		}
	}, [isOpen, editingSchedule, template, workspaces]);

	// Check if current cwd is a Git repo
	useEffect(() => {
		if (!cwd.trim()) {
			setIsGitRepo(false);
			return;
		}
		let active = true;
		gitRepoRoot(cwd.trim())
			.then((root) => {
				if (active) {
					const repo = !!root;
					setIsGitRepo(repo);
					if (!repo && runMode === "worktree") {
						setRunMode("local");
					}
				}
			})
			.catch(() => {
				if (active) setIsGitRepo(false);
			});
		return () => {
			active = false;
		};
	}, [cwd, runMode]);

	const handleBrowseCwd = async () => {
		try {
			const sel = await openDialog({ directory: true, multiple: false });
			if (typeof sel === "string") {
				setCwd(sel);
			}
		} catch (e) {
			console.error("Browse directory failed:", e);
		}
	};

	const toggleWeekday = (d: number) => {
		setWeekdays((prev) => {
			if (prev.includes(d)) {
				return prev.filter((x) => x !== d);
			}
			return [...prev, d].sort((a, b) => a - b);
		});
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!name.trim() || !prompt.trim() || !cwd.trim()) return;

		setSaving(true);
		try {
			const cadence: ScheduleCadence =
				cadenceType === "interval"
					? { kind: "interval", minutes: Math.max(5, intervalMinutes) }
					: {
							kind: "daily",
							time: dailyTime || "09:00",
							weekdays: weekdays.length === 7 ? [] : weekdays,
						};

			const draft: ScheduleDraft = {
				id: editingSchedule?.id,
				name: name.trim(),
				prompt: prompt.trim(),
				cwd: cwd.trim(),
				runMode,
				cadence,
				model: model || null,
				thinking: null,
				approvalMode,
				enabled: editingSchedule ? editingSchedule.enabled : true,
			};

			await onSave(draft);
			onClose();
		} finally {
			setSaving(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
			style={{ zIndex: Z_LAYER.modal }}
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl bg-[var(--bg-panel)] border border-[var(--border-divider)] shadow-2xl text-[13px] text-neutral-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
			>
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-divider)]">
					<h2 className="text-sm font-semibold text-neutral-100">
						{editingSchedule ? "编辑定时任务" : "新建定时任务"}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[var(--bg-hover)] transition-colors"
					>
						<X size={16} />
					</button>
				</div>

				{/* Body */}
				<form
					onSubmit={handleSubmit}
					className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
				>
					{/* Name */}
					<div>
						<label className="block text-xs font-medium text-neutral-400 mb-1.5">
							任务名称 <span className="text-rose-400">*</span>
						</label>
						<input
							type="text"
							required
							placeholder="例如：每日早上总结昨天提交"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full h-8 px-2.5 rounded-md bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-[#0A84FF]"
						/>
					</div>

					{/* Prompt */}
					<div>
						<label className="block text-xs font-medium text-neutral-400 mb-1.5">
							提示词 (Prompt) <span className="text-rose-400">*</span>
						</label>
						<textarea
							required
							rows={4}
							placeholder="输入定时任务执行时发给 Agent 的提示词内容…"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							className="w-full p-2.5 rounded-md bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 placeholder:text-neutral-500 resize-y focus:outline-none focus:border-[#0A84FF] font-mono text-xs leading-relaxed"
						/>
					</div>

					{/* Project / CWD */}
					<div>
						<label className="block text-xs font-medium text-neutral-400 mb-1.5">
							项目目录 <span className="text-rose-400">*</span>
						</label>
						<div className="flex gap-2">
							<input
								type="text"
								required
								value={cwd}
								onChange={(e) => setCwd(e.target.value)}
								placeholder="/path/to/project"
								className="flex-1 h-8 px-2.5 rounded-md bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 placeholder:text-neutral-500 text-xs font-mono focus:outline-none focus:border-[#0A84FF]"
							/>
							<button
								type="button"
								onClick={handleBrowseCwd}
								className="h-8 px-3 rounded-md bg-[var(--bg-hover)] border border-[var(--border-divider)] text-neutral-300 hover:text-white flex items-center gap-1.5 text-xs transition-colors shrink-0"
							>
								<FolderOpen size={13} />
								<span>浏览…</span>
							</button>
						</div>

						{/* Quick select from workspaces */}
						{workspaces.length > 0 && (
							<div className="flex flex-wrap gap-1.5 mt-2">
								<span className="text-[11px] text-neutral-500 py-0.5">常用：</span>
								{workspaces.map((ws) => (
									<button
										key={ws.id}
										type="button"
										onClick={() => setCwd(ws.path)}
										className={clsx(
											"px-2 py-0.5 rounded text-[11px] transition-colors border",
											cwd === ws.path
												? "bg-[#0A84FF]/20 border-[#0A84FF]/50 text-[#0A84FF]"
												: "bg-[var(--bg)] border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
										)}
									>
										{ws.name}
									</button>
								))}
							</div>
						)}
					</div>

					{/* Run mode: Local vs Worktree */}
					<div>
						<label className="block text-xs font-medium text-neutral-400 mb-1.5">
							运行位置
						</label>
						<div className="grid grid-cols-2 gap-2">
							<button
								type="button"
								onClick={() => setRunMode("local")}
								className={clsx(
									"p-2.5 rounded-lg border text-left transition-all",
									runMode === "local"
										? "bg-[#0A84FF]/10 border-[#0A84FF] text-white"
										: "bg-[var(--bg)] border-[var(--border-divider)] text-neutral-300 hover:border-neutral-600",
								)}
							>
								<div className="font-medium text-xs">本地目录</div>
								<div className="text-[11px] text-neutral-400 mt-0.5">
									直接在项目当前目录运行
								</div>
							</button>

							<button
								type="button"
								disabled={!isGitRepo}
								onClick={() => setRunMode("worktree")}
								className={clsx(
									"p-2.5 rounded-lg border text-left transition-all",
									!isGitRepo
										? "opacity-45 cursor-not-allowed bg-[var(--bg)] border-[var(--border-divider)] text-neutral-500"
										: runMode === "worktree"
											? "bg-[#0A84FF]/10 border-[#0A84FF] text-white"
											: "bg-[var(--bg)] border-[var(--border-divider)] text-neutral-300 hover:border-neutral-600",
								)}
							>
								<div className="font-medium text-xs flex items-center justify-between">
									<span>独立 Git Worktree</span>
									{!isGitRepo && (
										<span className="text-[10px] text-amber-400">非 Git</span>
									)}
								</div>
								<div className="text-[11px] text-neutral-400 mt-0.5">
									自动隔离在专属分支中运行
								</div>
							</button>
						</div>
					</div>

					{/* Cadence */}
					<div className="border border-[var(--border-divider)] rounded-lg p-3 bg-[var(--bg)]/40 space-y-3">
						<div className="flex items-center justify-between">
							<label className="text-xs font-medium text-neutral-300">
								执行频率
							</label>
							<div className="flex rounded-md p-0.5 bg-[var(--bg)] border border-[var(--border-divider)] text-xs">
								<button
									type="button"
									onClick={() => setCadenceType("daily")}
									className={clsx(
										"px-2.5 py-0.5 rounded text-[11px] transition-colors",
										cadenceType === "daily"
											? "bg-[#0A84FF] text-white font-medium shadow-sm"
											: "text-neutral-400 hover:text-neutral-200",
									)}
								>
									按天调度 (Daily)
								</button>
								<button
									type="button"
									onClick={() => setCadenceType("interval")}
									className={clsx(
										"px-2.5 py-0.5 rounded text-[11px] transition-colors",
										cadenceType === "interval"
											? "bg-[#0A84FF] text-white font-medium shadow-sm"
											: "text-neutral-400 hover:text-neutral-200",
									)}
								>
									按间隔调度 (Interval)
								</button>
							</div>
						</div>

						{cadenceType === "daily" ? (
							<div className="space-y-2.5">
								<div className="flex items-center gap-3">
									<label className="text-xs text-neutral-400 shrink-0">
										执行时间：
									</label>
									<input
										type="time"
										value={dailyTime}
										onChange={(e) => setDailyTime(e.target.value)}
										className="h-7 px-2 rounded bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 text-xs focus:outline-none focus:border-[#0A84FF]"
									/>
									<div className="flex gap-1.5 ml-auto">
										<button
											type="button"
											onClick={() => setWeekdays([])}
											className={clsx(
												"px-2 py-0.5 rounded text-[11px] border transition-colors",
												weekdays.length === 0 || weekdays.length === 7
													? "bg-[#0A84FF]/20 border-[#0A84FF]/50 text-[#0A84FF]"
													: "border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
											)}
										>
											每天
										</button>
										<button
											type="button"
											onClick={() => setWeekdays([1, 2, 3, 4, 5])}
											className={clsx(
												"px-2 py-0.5 rounded text-[11px] border transition-colors",
												weekdays.length === 5 &&
													[1, 2, 3, 4, 5].every((d) => weekdays.includes(d))
													? "bg-[#0A84FF]/20 border-[#0A84FF]/50 text-[#0A84FF]"
													: "border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
											)}
										>
											工作日
										</button>
										<button
											type="button"
											onClick={() => setWeekdays([0, 6])}
											className={clsx(
												"px-2 py-0.5 rounded text-[11px] border transition-colors",
												weekdays.length === 2 &&
													weekdays.includes(0) &&
													weekdays.includes(6)
													? "bg-[#0A84FF]/20 border-[#0A84FF]/50 text-[#0A84FF]"
													: "border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
											)}
										>
											周末
										</button>
									</div>
								</div>

								{/* Weekday chips */}
								<div className="flex items-center gap-1.5 pt-1">
									<span className="text-[11px] text-neutral-400 mr-1 shrink-0">
										星期：
									</span>
									{WEEKDAYS.map((w) => {
										const selected =
											weekdays.length === 0 ||
											weekdays.length === 7 ||
											weekdays.includes(w.id);
										return (
											<button
												key={w.id}
												type="button"
												onClick={() => toggleWeekday(w.id)}
												className={clsx(
													"flex-1 py-1 rounded text-xs border text-center transition-colors",
													selected
														? "bg-[#0A84FF]/20 border-[#0A84FF] text-[#0A84FF] font-medium"
														: "bg-[var(--bg)] border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
												)}
											>
												{w.label}
											</button>
										);
									})}
								</div>
							</div>
						) : (
							<div className="space-y-2.5">
								<div className="flex items-center gap-3">
									<label className="text-xs text-neutral-400 shrink-0">
										执行间隔：
									</label>
									<input
										type="number"
										min={5}
										value={intervalMinutes}
										onChange={(e) =>
											setIntervalMinutes(Math.max(5, parseInt(e.target.value) || 5))
										}
										className="w-24 h-7 px-2 rounded bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 text-xs focus:outline-none focus:border-[#0A84FF]"
									/>
									<span className="text-xs text-neutral-400">分钟 (≥ 5)</span>
								</div>

								{/* Interval presets */}
								<div className="flex gap-1.5">
									{[15, 30, 60, 120, 240].map((m) => (
										<button
											key={m}
											type="button"
											onClick={() => setIntervalMinutes(m)}
											className={clsx(
												"px-2.5 py-1 rounded text-xs border transition-colors",
												intervalMinutes === m
													? "bg-[#0A84FF]/20 border-[#0A84FF] text-[#0A84FF]"
													: "bg-[var(--bg)] border-[var(--border-divider)] text-neutral-400 hover:text-neutral-200",
											)}
										>
											{m >= 60 ? `${m / 60} 小时` : `${m} 分钟`}
										</button>
									))}
								</div>
							</div>
						)}
					</div>

					{/* Model select & Approval mode */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="block text-xs font-medium text-neutral-400 mb-1.5">
								模型（可选）
							</label>
							<ModelSelect
								label={
									model
										? (availableModels.find(
												(m) => toModelKey(m.provider, m.id) === model,
											)?.name ?? model)
										: "默认模型"
								}
								models={availableModels}
								currentValue={model ?? ""}
								onSelect={(val) => setModel(val || null)}
								extras={[{ value: "", label: "使用默认模型" }]}
								buttonClass="w-full h-8 px-2.5 rounded-md bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 text-left text-xs flex items-center justify-between"
								widthClass="w-[320px]"
								direction="up"
							/>
						</div>

						<div>
							<label className="block text-xs font-medium text-neutral-400 mb-1.5">
								审批模式
							</label>
							<select
								value={approvalMode}
								onChange={(e) => setApprovalMode(e.target.value)}
								className="w-full h-8 px-2.5 rounded-md bg-[var(--bg)] border border-[var(--border-divider)] text-neutral-200 text-xs focus:outline-none focus:border-[#0A84FF]"
							>
								<option value="always-ask">每次询问 (Always ask)</option>
								<option value="write">写入需审批 (Write)</option>
								<option value="yolo">全自动执行 (YOLO)</option>
							</select>
						</div>
					</div>

					{/* Risk notice */}
					<div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2.5 text-[11px] text-amber-300/90 leading-relaxed">
						⚠️ 注意：若定时任务在无人值守时触发且需审批，将在收件箱中等待确认。
					</div>

					{/* Footer */}
					<div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border-divider)]">
						<button
							type="button"
							onClick={onClose}
							className="px-3.5 py-1.5 rounded-md bg-[var(--bg-hover)] text-neutral-300 hover:text-white text-xs transition-colors"
						>
							取消
						</button>
						<button
							type="submit"
							disabled={saving}
							className="px-4 py-1.5 rounded-md bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white font-medium text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
						>
							{saving && (
								<span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
							)}
							<span>{editingSchedule ? "保存更新" : "创建任务"}</span>
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
