/**
 * StartPage: Centered, sleek command bar with a refined brand hero header.
 * Clean, balanced, Raycast/Linear-style layout — no bulky cards, just pure focus.
 */

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowUp,
	Check,
	ChevronDown,
	FolderOpen,
	FolderPlus,
	Loader2,
	Sparkles,
} from "lucide-react";
import { ModelSelect } from "../../components/ModelSelect";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useHomeDir } from "../../lib/hooks";
import { appPaths, listModels } from "../../lib/ipc";
import { type ModelOption, parseModels, toModelKey } from "../../lib/models";
import { basename, shortPath } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

const CUSTOM = "__custom";
const CUSTOM_MODEL = "__custom_model";

export function StartPage() {
	const workspaces = useSessions((s) => s.workspaces);
	const selectSession = useUi((s) => s.selectSession);

	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const [wsSel, setWsSel] = useState(() => workspaces[0]?.id ?? CUSTOM);
	const [customCwd, setCustomCwd] = useState("");
	const [globalDir, setGlobalDir] = useState("");
	const [wsOpen, setWsOpen] = useState(false);
	const wsMenuRef = useRef<HTMLDivElement>(null);
	const home = useHomeDir();

	const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
		try {
			const cached = localStorage.getItem("ompws:cached-models");
			if (cached) {
				const parsed = JSON.parse(cached);
				if (Array.isArray(parsed)) return parsed;
			}
		} catch {
			/* ignore */
		}
		return [];
	});
	const [modelSel, setModelSel] = useState("");
	const [customModel, setCustomModel] = useState("");

	useEffect(() => {
		appPaths()
			.then((p) => setGlobalDir(p.globalDir))
			.catch(() => {});
		listModels()
			.then((models) => {
				if (Array.isArray(models) && models.length > 0) {
					const parsed = parseModels(models);
					if (parsed.length > 0) {
						setAvailableModels(parsed);
						try {
							localStorage.setItem(
								"ompws:cached-models",
								JSON.stringify(parsed),
							);
						} catch {
							/* ignore */
						}
					}
				}
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (wsSel === CUSTOM && !customCwd && workspaces.length > 0) {
			setWsSel(workspaces[0].id);
		}
	}, [workspaces, wsSel, customCwd]);

	// Close workspace dropdown on outside click or Esc
	useEffect(() => {
		if (!wsOpen) return;
		const onDown = (e: MouseEvent) => {
			if (!wsMenuRef.current?.contains(e.target as Node)) setWsOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.isComposing) setWsOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [wsOpen]);

	const cwd = useMemo(() => {
		if (wsSel === CUSTOM) return customCwd.trim();
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return customCwd.trim();
		return w.kind === "global" ? globalDir : w.path;
	}, [wsSel, workspaces, customCwd, globalDir]);

	const wsLabel = useMemo(() => {
		if (wsSel === CUSTOM) {
			const p = customCwd.trim();
			return p ? basename(p) : "目录…";
		}
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return "目录";
		return w.kind === "global" ? "全局工作区" : (w.name ?? basename(w.path));
	}, [wsSel, workspaces, customCwd]);

	const pickDirectory = async () => {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: "选择工作区目录",
				defaultPath: customCwd || undefined,
			});
			if (selected && typeof selected === "string") {
				setWsSel(CUSTOM);
				setCustomCwd(selected);
			}
		} catch (e) {
			toast.error(errMsg(e));
		}
		setWsOpen(false);
	};

	const effectiveModel =
		modelSel === CUSTOM_MODEL ? customModel.trim() : modelSel;

	const submit = async () => {
		const targetPrompt = prompt.trim();
		if (!cwd || !targetPrompt || busy) return;
		setBusy(true);
		try {
			const { sessionId, stub } = await createSession({
				cwd,
				model: effectiveModel || null,
				approvalMode: null,
				workspaceId: wsSel === CUSTOM ? null : wsSel,
			});
			useSessions.getState().upsert([stub]);
			await sendFirstPrompt(sessionId, targetPrompt);
			selectSession(sessionId);
			setPrompt("");
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const canSubmit = !!cwd && !!prompt.trim() && !busy;

	return (
		<div className="relative flex h-full w-full flex-col items-center justify-center px-4 select-none">
			{/* Subtle ambient lighting */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 flex items-center justify-center"
			>
				<div className="h-[360px] w-[560px] rounded-full bg-gradient-to-tr from-indigo-500/10 via-amber-500/5 to-purple-500/10 blur-3xl opacity-60" />
			</div>

			<div className="relative flex w-full max-w-[700px] flex-col items-center">
				{/* Refined Brand Hero Header */}
				<div className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-400/25 bg-gradient-to-b from-indigo-500/20 to-indigo-600/5 shadow-md shadow-indigo-950/40">
					<Sparkles size={18} className="text-indigo-300" />
				</div>

				<h1 className="text-2xl font-semibold tracking-tight text-neutral-100 sm:text-3xl">
					今天想做什么？
				</h1>
				<p className="mt-1.5 text-xs text-neutral-400/80">
					输入任务目标，Agent 将在沙盒进程中自主规划、执行与交付
				</p>

				{/* Center Command Bar: Single sleek horizontal pill */}
				<div className="group relative mt-7 flex h-14 w-full items-center gap-2 rounded-2xl border border-neutral-700/80 bg-neutral-900/90 px-3 shadow-2xl shadow-black/50 backdrop-blur-xl transition-all duration-200 focus-within:border-neutral-500 focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-10px_rgba(0,0,0,0.8)]">
					{/* Top edge subtle sheen highlight */}
					<div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-white/10 to-transparent" />

					{/* Workspace Pill */}
					<div className="relative shrink-0" ref={wsMenuRef}>
						<button
							type="button"
							onClick={() => setWsOpen((v) => !v)}
							title={`工作目录: ${cwd || "未选择"}`}
							className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-800/80 hover:text-neutral-100"
						>
							<FolderOpen size={13} className="shrink-0 text-amber-400" />
							<span className="max-w-[130px] truncate font-medium">
								{wsLabel}
							</span>
							<ChevronDown size={11} className="shrink-0 text-neutral-500" />
						</button>

						{wsOpen && (
							<div className="absolute bottom-full left-0 z-30 mb-2 w-[280px] rounded-xl border border-neutral-700/80 bg-neutral-900/95 py-1.5 shadow-2xl backdrop-blur-md">
								<div className="border-b border-neutral-800 px-3 py-1 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">
									工作目录
								</div>
								<div className="max-h-60 overflow-y-auto py-1">
									{workspaces.map((w) => {
										const label =
											w.kind === "global"
												? "全局工作区"
												: (w.name ?? basename(w.path));
										const path = w.kind === "global" ? globalDir : w.path;
										const isSelected = wsSel === w.id;
										return (
											<button
												key={w.id}
												type="button"
												onClick={() => {
													setWsSel(w.id);
													setWsOpen(false);
												}}
												className={clsx(
													"flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
													isSelected
														? "bg-indigo-600/15 text-indigo-300"
														: "text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100",
												)}
											>
												<div className="min-w-0 pr-2">
													<div className="truncate font-medium">{label}</div>
													<div className="truncate font-mono text-[10px] text-neutral-500">
														{shortPath(path, home)}
													</div>
												</div>
												{isSelected && (
													<Check
														size={13}
														className="shrink-0 text-indigo-400"
													/>
												)}
											</button>
										);
									})}

									<div className="my-1 border-t border-neutral-800/80" />

									<button
										type="button"
										onClick={() => void pickDirectory()}
										className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100"
									>
										<FolderPlus
											size={13}
											className="shrink-0 text-neutral-400"
										/>
										<span>选择其他目录…</span>
									</button>
								</div>
							</div>
						)}
					</div>

					{/* Center Input (Single sleek line) */}
					<input
						ref={inputRef}
						autoFocus
						type="text"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								void submit();
							}
						}}
						placeholder="输入任务或需求，按回车立即开始..."
						style={{ outline: "none", boxShadow: "none" }}
						className="min-w-0 flex-1 bg-transparent px-2 text-[14px] text-neutral-100 placeholder-neutral-500 outline-none !outline-none focus:outline-none focus:ring-0 selection:bg-indigo-500/30"
					/>

					{/* Model Selector Chip */}
					<div className="shrink-0">
						<ModelSelect
							direction="up"
							widthClass="w-[360px]"
							label={
								modelSel === CUSTOM_MODEL
									? (customModel.trim() || "自定义…")
									: modelSel
										? (availableModels.find(
												(m: ModelOption) =>
													toModelKey(m.provider, m.id) === modelSel,
											)?.name ?? modelSel)
										: "默认模型"
							}
							buttonClass="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-neutral-800/80 hover:text-neutral-200"
							models={availableModels.length > 0 ? availableModels : null}
							currentValue={modelSel}
							extras={[
								{ value: "", label: "默认（跟随全局设置）" },
								{
									value: CUSTOM_MODEL,
									label: "自定义模型…",
									hint: "手动输入模型标识",
								},
							]}
							onSelect={(v: string) => setModelSel(v)}
						/>
					</div>

					{modelSel === CUSTOM_MODEL && (
						<input
							type="text"
							value={customModel}
							onChange={(e) => setCustomModel(e.target.value)}
							placeholder="provider/model-id"
							className="w-32 shrink-0 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-indigo-500"
						/>
					)}

					{/* Send / Action Button */}
					<button
						type="button"
						onClick={() => void submit()}
						disabled={!canSubmit}
						title={cwd ? "回车启动" : "请先选择工作目录"}
						className={clsx(
							"flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
							canSubmit
								? "bg-white text-neutral-950 shadow-md hover:bg-neutral-200 active:scale-95"
								: "cursor-not-allowed bg-neutral-800/70 text-neutral-500",
						)}
					>
						{busy ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<ArrowUp size={15} strokeWidth={2.4} />
						)}
					</button>
				</div>

				{/* Subtle keyboard hint below */}
				<div className="mt-3.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
					<kbd className="rounded border border-neutral-800 bg-neutral-900/80 px-1.5 py-0.5 font-mono text-[9px] text-neutral-400">
						↵ Enter
					</kbd>
					<span>开工新会话 · 独立沙盒进程</span>
				</div>
			</div>
		</div>
	);
}
