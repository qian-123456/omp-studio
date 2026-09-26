/**
 * StartPage: centered hero "new session" composer (ChatGPT/Codex-style start
 * surface). One big prompt card over a quiet ambient backdrop; workspace and
 * model pickers live inside the card as capsule chips.
 */

import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
	ArrowUp,
	Check,
	ChevronDown,
	FolderOpen,
	FolderPlus,
	Loader2,
	Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const chip =
	"flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-neutral-200 transition-colors";

export function StartPage() {
	const workspaces = useSessions((s) => s.workspaces);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);

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

	// Close the workspace menu on outside click / Esc.
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
			return p ? basename(p) : "选择目录…";
		}
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return "选择工作区";
		return w.kind === "global" ? "全局" : (w.name ?? basename(w.path));
	}, [wsSel, workspaces, customCwd]);

	const pickDirectory = async () => {
		try {
			const selected = await open({
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
		if (!cwd || !prompt.trim() || busy) return;
		setBusy(true);
		try {
			const { sessionId, stub } = await createSession({
				cwd,
				model: effectiveModel || null,
				approvalMode: null,
				workspaceId: wsSel === CUSTOM ? null : wsSel,
			});
			useSessions.getState().upsert([stub]);
			await sendFirstPrompt(sessionId, prompt);
			useUi.getState().selectSession(sessionId);
			setPrompt("");
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const canSubmit = !!cwd && !!prompt.trim() && !busy;

	return (
		<div className="relative flex h-full flex-col items-center justify-center overflow-hidden">
			{/* Ambient glow backdrop */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					background:
						"radial-gradient(52% 44% at 50% 42%, rgba(99,102,241,0.14), transparent 72%)",
				}}
			/>

			<div className="relative flex w-[600px] max-w-[92%] flex-col items-center">
				{/* Brand mark */}
				<div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-400/25 bg-gradient-to-b from-indigo-500/30 to-indigo-600/10 shadow-lg shadow-indigo-950/40">
					<Sparkles size={20} className="text-indigo-300" />
				</div>
				<h1 className="mb-1.5 text-[19px] font-semibold tracking-tight text-neutral-100">
					今天想做什么？
				</h1>
				<p className="mb-7 text-xs text-neutral-500">
					描述任务，回车即开工 —— 新会话在独立进程中运行
				</p>

				{/* Composer card */}
				<div className="w-full rounded-2xl border border-neutral-800/80 bg-neutral-900/90 shadow-xl shadow-black/30 backdrop-blur-sm transition-all duration-200 focus-within:border-neutral-700 focus-within:ring-1 focus-within:ring-neutral-700/40">
					<textarea
						autoFocus
						rows={4}
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void submit();
							}
						}}
						placeholder="描述你的任务，比如：给首页加一个深色模式开关…"
						className="w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3.5 pb-2 text-[13.5px] leading-relaxed text-neutral-100 placeholder-neutral-500/70 outline-none"
					/>

					{/* Toolbar: context chips left, send right */}
					<div className="flex items-center gap-1.5 border-t border-neutral-800/60 px-2.5 py-2">
						{/* Workspace capsule */}
						<div className="relative" ref={wsMenuRef}>
							<button
								type="button"
								onClick={() => setWsOpen((v) => !v)}
								title={`工作目录: ${cwd || "未选择"}`}
								className={chip}
							>
								<FolderOpen size={12} className="shrink-0" />
								<span className="max-w-[180px] truncate">{wsLabel}</span>
								<ChevronDown
									size={10}
									className="shrink-0 text-neutral-500"
								/>
							</button>
							{wsOpen && (
								<div className="absolute bottom-full left-0 z-30 mb-1 w-[280px] rounded-xl border border-neutral-700 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md">
									<div className="border-b border-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-400">
										工作目录
									</div>
									<div className="max-h-64 overflow-y-auto py-0.5">
										{workspaces.map((w) => {
											const label =
												w.kind === "global"
													? "全局"
													: (w.name ?? w.path);
											const path =
												w.kind === "global" ? globalDir : w.path;
											return (
												<button
													key={w.id}
													type="button"
													onClick={() => {
														setWsSel(w.id);
														setWsOpen(false);
													}}
													className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
												>
													<div className="min-w-0">
														<div className="truncate font-medium">
															{label}
														</div>
														<div className="truncate text-[10px] text-neutral-500">
															{shortPath(path, home)}
														</div>
													</div>
													{wsSel === w.id && (
														<Check
															size={13}
															className="shrink-0 text-indigo-400"
														/>
													)}
												</button>
											);
										})}
										<button
											type="button"
											onClick={() => void pickDirectory()}
											className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
										>
											<FolderPlus
												size={12}
												className="shrink-0 text-neutral-400"
											/>
											选择其他目录…
										</button>
										{wsSel === CUSTOM && customCwd && (
											<div className="flex items-center justify-between px-2.5 py-1.5 text-xs">
												<div className="min-w-0">
													<div className="font-medium text-neutral-300">
														自定义目录
													</div>
													<div className="truncate text-[10px] text-neutral-500">
														{customCwd}
													</div>
												</div>
												<Check
													size={13}
													className="shrink-0 text-indigo-400"
												/>
											</div>
										)}
									</div>
								</div>
							)}
						</div>

						{/* Model capsule */}
						<ModelSelect
							direction="up"
							widthClass="w-[380px]"
							label={
								modelSel === CUSTOM_MODEL
									? (customModel.trim() || "自定义模型…")
									: modelSel
										? (availableModels.find(
												(m) =>
													toModelKey(m.provider, m.id) === modelSel,
											)?.name ?? modelSel)
										: "默认模型"
							}
							buttonClass={chip}
							models={availableModels.length > 0 ? availableModels : null}
							currentValue={modelSel}
							extras={[
								{ value: "", label: "默认（跟随设置）" },
								{
									value: CUSTOM_MODEL,
									label: "自定义模型…",
									hint: "手动输入",
								},
							]}
							onSelect={(v) => setModelSel(v)}
						/>
						{modelSel === CUSTOM_MODEL && (
							<input
								type="text"
								value={customModel}
								onChange={(e) => setCustomModel(e.target.value)}
								placeholder="provider/model-id"
								className="w-40 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
							/>
						)}

						<div className="flex-1" />

						{/* Send button: bright-white when armed, quiet when empty */}
						<button
							type="button"
							onClick={() => void submit()}
							disabled={!canSubmit}
							title={cwd ? "开始新会话" : "请先选择工作目录"}
							className={clsx(
								"flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
								canSubmit
									? "bg-white text-neutral-950 shadow-sm hover:bg-neutral-200 active:scale-95"
									: "cursor-not-allowed bg-neutral-800/80 text-neutral-500",
							)}
						>
							{busy ? (
								<Loader2 size={13} className="animate-spin" />
							) : (
								<ArrowUp size={14} strokeWidth={2.4} />
							)}
						</button>
					</div>
				</div>

				<p className="mt-4 text-[11px] text-neutral-600">
					Enter 发送 · Shift+Enter 换行 · 会话可在左侧列表继续管理
				</p>
			</div>
		</div>
	);
}
