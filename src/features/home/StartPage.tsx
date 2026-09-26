/**
 * StartPage component: Centered "start a session" page.
 * Replaces TodoHome as the default home view.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUp, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelSelect } from "../../components/ModelSelect";
import { createSession, sendFirstPrompt } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { appPaths, listModels } from "../../lib/ipc";
import { type ModelOption, parseModels, toModelKey } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

const CUSTOM = "__custom";
const CUSTOM_MODEL = "__custom_model";

export function StartPage() {
	const workspaces = useSessions((s) => s.workspaces);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);

	const [wsSel, setWsSel] = useState(() => workspaces[0]?.id ?? CUSTOM);
	const [customCwd, setCustomCwd] = useState("");
	const [globalDir, setGlobalDir] = useState("");

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

	const cwd = useMemo(() => {
		if (wsSel === CUSTOM) return customCwd.trim();
		const w = workspaces.find((x) => x.id === wsSel);
		if (!w) return customCwd.trim();
		return w.kind === "global" ? globalDir : w.path;
	}, [wsSel, workspaces, customCwd, globalDir]);

	const handleBrowse = async () => {
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
	};

	const effectiveModel = modelSel === CUSTOM_MODEL ? customModel.trim() : modelSel;

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

	return (
		<div className="flex h-full items-center justify-center p-4">
			<div className="w-[560px] max-w-[92%] rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
				<div className="mb-3 flex items-center justify-between">
					<span className="text-xs font-medium text-neutral-300">开始新任务</span>
				</div>

				<div className="mb-4">
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
						placeholder="描述你的任务... (Enter 发送，Shift+Enter 换行)"
						className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-indigo-500"
					/>
				</div>

				<div className="mb-4 space-y-2.5">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-center">
						<label className="w-16 shrink-0 text-xs text-neutral-400">工作区</label>
						<div className="flex-1">
							{wsSel !== CUSTOM ? (
								<select
									value={wsSel}
									onChange={(e) => setWsSel(e.target.value)}
									className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-indigo-500"
								>
									{workspaces.map((w) => (
										<option key={w.id} value={w.id}>
											{w.kind === "global" ? "全局" : (w.name ?? w.path)}
										</option>
									))}
									<option value={CUSTOM}>自定义目录…</option>
								</select>
							) : (
								<div className="flex items-center gap-1.5">
									<input
										type="text"
										value={customCwd}
										onChange={(e) => setCustomCwd(e.target.value)}
										placeholder="输入目录路径..."
										className="flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-indigo-500"
									/>
									<button
										type="button"
										onClick={handleBrowse}
										className="flex shrink-0 items-center gap-1 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 hover:text-white"
										title="浏览目录"
									>
										<FolderOpen size={13} />
										<span>浏览…</span>
									</button>
									{workspaces.length > 0 && (
										<button
											type="button"
											onClick={() => setWsSel(workspaces[0]?.id ?? CUSTOM)}
											className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
											title="返回选择工作区"
										>
											返回
										</button>
									)}
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-col gap-1 sm:flex-row sm:items-center">
						<label className="w-16 shrink-0 text-xs text-neutral-400">模型</label>
						<div className="flex-1">
							<ModelSelect
								direction="down"
								widthClass="w-full"
								icon={false}
								label={
									modelSel === CUSTOM_MODEL
										? "自定义模型…"
										: modelSel
											? (availableModels.find(
													(m) => toModelKey(m.provider, m.id) === modelSel,
												)?.name ?? modelSel)
											: "默认（跟随设置）"
								}
								buttonClass="flex w-full items-center justify-between rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-left text-xs text-neutral-200 outline-none focus:border-indigo-500"
								models={availableModels.length > 0 ? availableModels : []}
								currentValue={modelSel}
								extras={[
									{ value: "", label: "默认（跟随设置）" },
									{
										value: CUSTOM_MODEL,
										label: "自定义模型…",
										hint: "手动输入",
									},
								]}
								onSelect={(v: string) => setModelSel(v)}
							/>
							{modelSel === CUSTOM_MODEL && (
								<input
									type="text"
									value={customModel}
									onChange={(e) => setCustomModel(e.target.value)}
									placeholder="例如 anthropic/claude-3-7-sonnet"
									className="mt-1.5 w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-200 outline-none focus:border-indigo-500"
								/>
							)}
						</div>
					</div>
				</div>

				<div className="flex items-center justify-end border-t border-neutral-800/80 pt-3">
					<button
						type="button"
						onClick={() => void submit()}
						disabled={!cwd || !prompt.trim() || busy}
						className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
					>
						{busy ? (
							<Loader2 size={13} className="animate-spin" />
						) : (
							<ArrowUp size={13} />
						)}
						<span>开始</span>
					</button>
				</div>
			</div>
		</div>
	);
}
