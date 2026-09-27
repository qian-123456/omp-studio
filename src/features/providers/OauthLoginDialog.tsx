import { useCallback, useEffect, useRef, useState } from "react";
import {
	AlertCircle,
	Check,
	CheckCircle2,
	ExternalLink,
	Loader2,
	LogIn,
	RefreshCw,
	Terminal,
	X,
} from "lucide-react";
import type { OauthLoginProvider, OauthUiEvent } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { onProvidersOauth } from "../../lib/events";
import { useEscapeKey } from "../../lib/hooks";
import {
	oauthLoginCancel,
	oauthLoginOpenUrl,
	oauthLoginProviders,
	oauthLoginRespond,
	oauthLoginStart,
	oauthLoginStatus,
} from "../../lib/ipc";
import { useProviders } from "./store";

interface Props {
	onClose: () => void;
}

type Phase = "list" | "flow";

interface PendingPrompt {
	requestId: string;
	method: string;
	title?: string | null;
	placeholder?: string | null;
	message?: string | null;
	timeoutMs?: number | null;
}

interface FlowState {
	provider: OauthLoginProvider;
	started: boolean;
	url: string | null;
	launchUrl: string | null;
	instructions: string | null;
	notifications: string[];
	pendingPrompt: PendingPrompt | null;
	completed: {
		ok: boolean;
		error: string | null;
	} | null;
}

export function OauthLoginDialog({ onClose }: Props) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const loadOmp = useProviders((s) => s.loadOmp);

	const [phase, setPhase] = useState<Phase>("list");
	const [providers, setProviders] = useState<OauthLoginProvider[]>([]);
	const [listLoading, setListLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);

	const [flowState, setFlowState] = useState<FlowState | null>(null);
	const [inputValue, setInputValue] = useState("");
	const [submittingPrompt, setSubmittingPrompt] = useState(false);

	const unlistenRef = useRef<(() => void) | null>(null);
	const isFlowActiveRef = useRef(false);
	const isClosingRef = useRef(false);

	const loadProviders = useCallback(async () => {
		setListLoading(true);
		setListError(null);
		try {
			const res = await oauthLoginProviders();
			setProviders(res);
		} catch (err) {
			setListError(errMsg(err));
		} finally {
			setListLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadProviders();
	}, [loadProviders]);

	const handleEvent = useCallback(
		(event: OauthUiEvent, targetProviderId: string) => {
			if (event.providerId !== targetProviderId) return;

			setFlowState((prev) => {
				if (!prev) return prev;
				const next: FlowState = { ...prev };

				switch (event.kind) {
					case "started":
						next.started = true;
						break;
					case "openUrl":
						next.started = true;
						if (event.url) next.url = event.url;
						if (event.launchUrl) next.launchUrl = event.launchUrl;
						if (event.instructions) next.instructions = event.instructions;
						break;
					case "notify":
						if (event.message) {
							next.notifications = [...next.notifications, event.message];
						}
						break;
					case "needsInput":
						next.pendingPrompt = {
							requestId: event.requestId ?? "",
							method: "input",
							title: event.title ?? "请输入内容",
							placeholder: event.placeholder ?? null,
							timeoutMs: event.timeoutMs ?? null,
							message: event.message ?? null,
						};
						setInputValue("");
						break;
					case "ui":
						next.pendingPrompt = {
							requestId: event.requestId ?? "",
							method: event.method ?? "confirm",
							title: event.title ?? null,
							placeholder: event.placeholder ?? null,
							message: event.message ?? null,
							timeoutMs: event.timeoutMs ?? null,
						};
						break;
					case "cancelledRequest":
						if (
							next.pendingPrompt &&
							next.pendingPrompt.requestId === event.requestId
						) {
							next.pendingPrompt = null;
						}
						break;
					case "completed":
						isFlowActiveRef.current = false;
						next.completed = {
							ok: Boolean(event.ok),
							error: event.error ?? null,
						};
						if (event.ok) {
							void loadOmp();
						}
						break;
				}
				return next;
			});
		},
		[loadOmp],
	);

	const startFlow = async (provider: OauthLoginProvider) => {
		if (!provider.available) return;

		const initialFlow: FlowState = {
			provider,
			started: false,
			url: null,
			launchUrl: null,
			instructions: null,
			notifications: [],
			pendingPrompt: null,
			completed: null,
		};
		setFlowState(initialFlow);
		setPhase("flow");
		isFlowActiveRef.current = true;

		if (unlistenRef.current) {
			unlistenRef.current();
			unlistenRef.current = null;
		}

		try {
			// 1. Subscribe to events FIRST
			const unlisten = await onProvidersOauth((event) => {
				handleEvent(event, provider.id);
			});
			unlistenRef.current = unlisten;

			// 2. Start login process
			await oauthLoginStart(provider.id);

			// 3. Hydrate any early event
			const status = await oauthLoginStatus();
			if (status && status.providerId === provider.id) {
				if (status.url) {
					handleEvent(
						{
							kind: "openUrl",
							providerId: provider.id,
							url: status.url,
							launchUrl: status.launchUrl,
							instructions: status.instructions,
						},
						provider.id,
					);
				}
				if (status.kind === "needsInput" && status.requestId) {
					handleEvent(
						{
							kind: "needsInput",
							providerId: provider.id,
							requestId: status.requestId,
							title: status.title,
							placeholder: status.placeholder,
						},
						provider.id,
					);
				}
			}
		} catch (err) {
			isFlowActiveRef.current = false;
			const errorText = errMsg(err);
			setFlowState((prev) =>
				prev
					? {
							...prev,
							completed: { ok: false, error: errorText },
						}
					: null,
			);
		}
	};

	const handlePromptResponse = async (payload: {
		value?: string;
		confirmed?: boolean;
		cancelled?: boolean;
	}) => {
		if (!flowState?.pendingPrompt) return;
		setSubmittingPrompt(true);
		const requestId = flowState.pendingPrompt.requestId;
		try {
			await oauthLoginRespond({
				type: "extension_ui_response",
				id: requestId,
				...payload,
			});
			setFlowState((prev) =>
				prev && prev.pendingPrompt?.requestId === requestId
					? { ...prev, pendingPrompt: null }
					: prev,
			);
		} catch (err) {
			setFlowState((prev) =>
				prev
					? {
							...prev,
							notifications: [
								...prev.notifications,
								`响应失败: ${errMsg(err)}`,
							],
						}
					: prev,
			);
		} finally {
			setSubmittingPrompt(false);
		}
	};

	const handleDismiss = useCallback(async () => {
		if (isClosingRef.current) return;

		if (phase === "flow" && flowState && !flowState.completed) {
			const confirmed = await confirmDialog("登录正在进行中，确定要取消吗？", {
				title: "取消登录",
				danger: true,
				okLabel: "取消登录",
			});
			if (!confirmed) return;
			try {
				await oauthLoginCancel();
			} catch {
				// Ignore cancel error
			}
			isFlowActiveRef.current = false;
		}

		isClosingRef.current = true;
		if (unlistenRef.current) {
			unlistenRef.current();
			unlistenRef.current = null;
		}
		onClose();
	}, [phase, flowState, onClose]);

	useEscapeKey(handleDismiss);

	useEffect(() => {
		return () => {
			if (unlistenRef.current) {
				unlistenRef.current();
				unlistenRef.current = null;
			}
			if (isFlowActiveRef.current) {
				void oauthLoginCancel();
				isFlowActiveRef.current = false;
			}
		};
	}, []);

	const isTerminalHint =
		Boolean(flowState?.completed?.error) &&
		/terminal|secret|终端/i.test(flowState?.completed?.error ?? "");

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-md"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) void handleDismiss();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="oauth-dialog-title"
				onKeyDown={(e) => {
					if (e.key !== "Tab") return;
					const controls = Array.from(
						e.currentTarget.querySelectorAll<HTMLElement>(
							'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
						),
					).filter((control) => control.getClientRects().length > 0);
					const first = controls[0];
					const last = controls[controls.length - 1];
					if (e.shiftKey && document.activeElement === first) {
						e.preventDefault();
						last?.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first?.focus();
					}
				}}
				className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-[var(--bg-panel)] shadow-apple-modal hairline"
			>
				{/* Dialog Header */}
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] px-4 py-3">
					<div className="flex items-center gap-2">
						<LogIn className="h-4 w-4 text-[#0A84FF]" />
						<div
							id="oauth-dialog-title"
							className="text-xs font-semibold tracking-[-0.018em] text-neutral-100"
						>
							{phase === "flow" && flowState
								? `登录 ${flowState.provider.name}`
								: "OAuth / 账号登录"}
						</div>
					</div>
					<button
						type="button"
						onClick={() => void handleDismiss()}
						aria-label="关闭"
						className="rounded-md p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{/* Dialog Body */}
				{phase === "list" ? (
					<div className="flex-1 space-y-3 overflow-y-auto p-4">
						<p className="text-xs text-neutral-400 leading-relaxed">
							通过 OMP 原生 RPC 授权流程快速完成登录。凭据将安全保存在 OMP
							的系统配置与凭证库中。
						</p>

						{listLoading && (
							<div className="flex items-center justify-center py-8 text-neutral-500">
								<Loader2 className="h-5 w-5 animate-spin" />
							</div>
						)}

						{listError && (
							<div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-3 text-xs text-rose-300 space-y-2">
								<div className="flex items-start gap-2">
									<AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
									<span className="min-w-0 flex-1 break-words">
										{listError}
									</span>
								</div>
								<div className="flex justify-end">
									<button
										type="button"
										onClick={() => void loadProviders()}
										className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-900/40"
									>
										<RefreshCw className="h-3 w-3" />
										<span>重试</span>
									</button>
								</div>
							</div>
						)}

						{!listLoading && !listError && providers.length === 0 && (
							<div className="py-8 text-center text-xs text-neutral-500">
								暂无支持登录的供应商
							</div>
						)}

						{!listLoading && !listError && providers.length > 0 && (
							<div className="space-y-1.5">
								{providers.map((p) => (
									<button
										key={p.id}
										type="button"
										disabled={!p.available}
										onClick={() => void startFlow(p)}
										className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left hairline transition-all ${
											p.available
												? "bg-[var(--well-bg)] hover:bg-[var(--bg-hover)] cursor-pointer active:scale-[0.99]"
												: "bg-[var(--well-bg)]/40 opacity-50 cursor-not-allowed"
										}`}
									>
										<div className="min-w-0 flex-1">
											<div className="text-xs font-medium text-neutral-200 truncate">
												{p.name}
											</div>
											<div className="text-[11px] font-mono text-neutral-500">
												{p.id}
											</div>
										</div>
										<div className="flex items-center gap-2 shrink-0">
											{p.authenticated && (
												<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-950/50 text-emerald-400 border border-emerald-700/40">
													<Check className="h-2.5 w-2.5" />
													<span>已登录</span>
												</span>
											)}
											{!p.available && (
												<span className="rounded px-1.5 py-0.5 text-[10px] text-neutral-500 bg-neutral-800">
													不可用
												</span>
											)}
										</div>
									</button>
								))}
							</div>
						)}
					</div>
				) : (
					/* Flow Phase */
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						{flowState && (
							<>
								{/* In-progress spinner if no prompt and not completed */}
								{!flowState.completed && !flowState.pendingPrompt && (
									<div className="flex flex-col items-center justify-center py-6 text-center space-y-2">
										<Loader2 className="h-6 w-6 animate-spin text-[#0A84FF]" />
										<div className="text-xs text-neutral-300">
											{flowState.url
												? "已在浏览器打开授权页面，请完成登录…"
												: "正在启动登录流程…"}
										</div>
									</div>
								)}

								{/* Open URL section */}
								{flowState.url && !flowState.completed && (
									<div className="rounded-xl hairline bg-[var(--well-bg)] p-3 space-y-2">
										<div className="flex items-center justify-between gap-2">
											<span className="text-xs font-medium text-neutral-200">
												授权验证地址
											</span>
											<button
												type="button"
												onClick={() => {
													if (flowState.url)
														void oauthLoginOpenUrl(flowState.url);
												}}
												className="inline-flex items-center gap-1 text-[11px] text-[#0A84FF] hover:underline"
											>
												<span>在浏览器打开</span>
												<ExternalLink className="h-3 w-3" />
											</button>
										</div>
										<div
											onClick={() => {
												if (flowState.url)
													void oauthLoginOpenUrl(flowState.url);
											}}
											className="cursor-pointer truncate rounded-lg bg-neutral-900/60 px-2.5 py-1.5 font-mono text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors"
											title={flowState.url}
										>
											{flowState.url}
										</div>
										{flowState.instructions && (
											<div className="text-[11px] leading-relaxed text-neutral-400">
												{flowState.instructions}
											</div>
										)}
									</div>
								)}

								{/* Notifications log */}
								{flowState.notifications.length > 0 && !flowState.completed && (
									<div className="rounded-xl hairline bg-[var(--well-bg)] p-3 space-y-1 max-h-32 overflow-y-auto font-mono text-[11px]">
										{flowState.notifications.map((msg, i) => (
											<div key={i} className="text-neutral-400 break-words">
												<span className="text-neutral-600 mr-1.5">&gt;</span>
												{msg}
											</div>
										))}
									</div>
								)}

								{/* Pending Prompt Card */}
								{flowState.pendingPrompt && !flowState.completed && (
									<div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 space-y-2.5">
										{flowState.pendingPrompt.method === "input" ? (
											<>
												<label className="block text-xs font-medium text-neutral-200">
													{flowState.pendingPrompt.title || "请输入内容"}
												</label>
												{flowState.pendingPrompt.message && (
													<p className="text-[11px] text-neutral-400">
														{flowState.pendingPrompt.message}
													</p>
												)}
												<textarea
													rows={2}
													value={inputValue}
													onChange={(e) => setInputValue(e.target.value)}
													placeholder={
														flowState.pendingPrompt.placeholder || ""
													}
													className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-1.5 font-mono text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
												/>
												<div className="flex items-center justify-end gap-2">
													<button
														type="button"
														disabled={submittingPrompt}
														onClick={() =>
															void handlePromptResponse({ cancelled: true })
														}
														className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
													>
														跳过 / 取消
													</button>
													<button
														type="button"
														disabled={submittingPrompt || !inputValue.trim()}
														onClick={() =>
															void handlePromptResponse({
																value: inputValue.trim(),
															})
														}
														className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-3 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 disabled:opacity-40"
													>
														{submittingPrompt && (
															<Loader2 className="h-3 w-3 animate-spin" />
														)}
														<span>提交</span>
													</button>
												</div>
											</>
										) : flowState.pendingPrompt.method === "confirm" ? (
											<>
												<div className="text-xs font-medium text-neutral-200">
													{flowState.pendingPrompt.title || "需要确认"}
												</div>
												{flowState.pendingPrompt.message && (
													<p className="text-[11px] text-neutral-400">
														{flowState.pendingPrompt.message}
													</p>
												)}
												<div className="flex items-center justify-end gap-2">
													<button
														type="button"
														disabled={submittingPrompt}
														onClick={() =>
															void handlePromptResponse({ confirmed: false })
														}
														className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
													>
														取消
													</button>
													<button
														type="button"
														disabled={submittingPrompt}
														onClick={() =>
															void handlePromptResponse({ confirmed: true })
														}
														className="inline-flex items-center gap-1.5 rounded-lg bg-[#0A84FF] px-3 py-1 text-xs font-medium text-white hover:bg-[#0A84FF]/90 disabled:opacity-40"
													>
														{submittingPrompt && (
															<Loader2 className="h-3 w-3 animate-spin" />
														)}
														<span>确认</span>
													</button>
												</div>
											</>
										) : (
											<>
												<div className="text-xs font-medium text-neutral-200">
													{flowState.pendingPrompt.title || "提示信息"}
												</div>
												{flowState.pendingPrompt.message && (
													<p className="text-[11px] font-mono whitespace-pre-wrap text-neutral-300">
														{flowState.pendingPrompt.message}
													</p>
												)}
												<div className="flex items-center justify-end">
													<button
														type="button"
														disabled={submittingPrompt}
														onClick={() =>
															void handlePromptResponse({ value: "" })
														}
														className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
													>
														关闭提示
													</button>
												</div>
											</>
										)}
									</div>
								)}

								{/* Completed State */}
								{flowState.completed && (
									<div className="space-y-4 py-4">
										{flowState.completed.ok ? (
											<div className="flex flex-col items-center justify-center space-y-2 text-center">
												<CheckCircle2 className="h-10 w-10 text-emerald-400" />
												<div className="text-sm font-semibold text-neutral-100">
													登录成功
												</div>
												<div className="text-xs text-neutral-400">
													凭据已写入 OMP，列表已刷新
												</div>
											</div>
										) : (
											<div className="flex flex-col items-center justify-center space-y-3 text-center">
												<AlertCircle className="h-10 w-10 text-rose-400" />
												<div className="text-sm font-semibold text-neutral-100">
													登录未完成
												</div>
												{flowState.completed.error && (
													<div className="w-full rounded-xl border border-rose-800/40 bg-rose-950/20 p-3 text-left font-mono text-xs text-rose-300 break-words">
														{flowState.completed.error}
													</div>
												)}
												{isTerminalHint && (
													<div className="flex items-start gap-2.5 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 text-left text-xs text-amber-300">
														<Terminal className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
														<span>
															该 Provider 需要在终端中完成登录，请运行 omp
															后使用 /login
														</span>
													</div>
												)}
											</div>
										)}
									</div>
								)}
							</>
						)}
					</div>
				)}

				{/* Dialog Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					{phase === "list" ? (
						<button
							type="button"
							onClick={() => void handleDismiss()}
							className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						>
							关闭
						</button>
					) : flowState?.completed?.ok ? (
						<button
							type="button"
							onClick={() => void handleDismiss()}
							className="rounded-lg bg-[#0A84FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 active:scale-95 transition-all shadow-sm"
						>
							完成
						</button>
					) : flowState?.completed ? (
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									setPhase("list");
									setFlowState(null);
									void loadProviders();
								}}
								className="rounded-lg px-3 py-1.5 text-xs text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
							>
								重试
							</button>
							<button
								type="button"
								onClick={() => void handleDismiss()}
								className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
							>
								关闭
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => void handleDismiss()}
							className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						>
							取消
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
