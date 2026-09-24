/** [B] Composer: annotation pills, slash autocomplete, held queue,
 * steer/stop, model + thinking pickers, /fork interception. */

import clsx from "clsx";
import { CornerDownRight, Send, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createSideChat, rpcSend } from "../../lib/ipc";
import { formatWithAnnotations, useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { useHeldQueue } from "./heldQueue";
import { abortTurn, sendPrompt } from "./send";
import {
	buildSetModelPayload,
	type ModelOption,
	parseModels,
	resolveCurrentModel,
	toModelKey,
} from "./modelPicker";

const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];


export function Composer({
	sessionId,
	readonly,
	compact,
}: {
	sessionId: string;
	/** External session — observation only. */
	readonly?: boolean;
	compact?: boolean;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [menuIndex, setMenuIndex] = useState(0);
	const [models, setModels] = useState<ModelOption[] | null>(null);
	const taRef = useRef<HTMLTextAreaElement>(null);

	const live = useLive((s) => s.sessions[sessionId]);
	const streaming = live?.streaming === true;
	const commands = live?.commands ?? [];
	const annotations = useComposer(
		(s) => s.annotations[sessionId] ?? [],
	);
	const removeAnnotation = useComposer((s) => s.removeAnnotation);
	const clearAnnotations = useComposer((s) => s.clearAnnotations);
	const held = useHeldQueue((s) => s.queues[sessionId] ?? []);
	const pushHeld = useHeldQueue((s) => s.push);
	const selectSession = useUi((s) => s.selectSession);
	const setRightTab = useUi((s) => s.setRightTab);

	// Slash autocomplete: only while the whole input is a "/partial" token.
	const slashMatch = /^\/(\S*)$/.exec(text);
	const menu = useMemo(() => {
		if (!slashMatch) return [];
		const q = slashMatch[1].toLowerCase();
		return [
			{ name: "fork", description: "分叉一个侧聊", hint: "<问题>" },
			...commands.map((c) => ({
				name: c.name,
				description: c.description ?? "",
				hint: c.hint ?? "",
			})),
		]
			.filter((c) => c.name.toLowerCase().startsWith(q))
			.slice(0, 8);
	}, [slashMatch, commands]);

	useEffect(() => setMenuIndex(0), [text]);

	const state = live?.state ?? {};
	const currentThinking = state.thinkingLevel as string | undefined;
	const current = useMemo(
		() => resolveCurrentModel(state.model, models),
		[state.model, models],
	);

	const loadModels = async () => {
		if (models !== null) return;
		try {
			const resp = (await rpcSend(sessionId, {
				type: "get_available_models",
			})) as Record<string, unknown>;
			setModels(parseModels(resp.data ?? resp));
		} catch {
			setModels([]);
		}
	};

	const fork = async (question: string) => {
		const info = await createSideChat(sessionId, question.trim());
		setText("");
		setRightTab("sidechat");
		selectSession(info.sessionId);
	};

	const submit = async (steer: boolean) => {
		const raw = text;
		if (!raw.trim() || busy) return;
		if (raw.startsWith("/fork ") || raw === "/fork") {
			await fork(raw.slice(5));
			return;
		}
		const message = formatWithAnnotations(raw, annotations);
		if (streaming && !steer) {
			pushHeld(sessionId, message);
			setText("");
			clearAnnotations(sessionId);
			return;
		}
		setBusy(true);
		try {
			await sendPrompt(sessionId, message, { steer });
			setText("");
			clearAnnotations(sessionId);
		} catch (err) {
			console.error("send failed", err);
		} finally {
			setBusy(false);
		}
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (menu.length > 0 && slashMatch) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setMenuIndex(
					(i) => (i + (e.key === "ArrowDown" ? 1 : -1) + menu.length) % menu.length,
				);
				return;
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				setText(`/${menu[menuIndex].name} `);
				return;
			}
			if (e.key === "Escape") {
				setText("");
				return;
			}
		}
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void submit(true);
		} else if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void submit(false);
		}
	};

	if (readonly) {
		return (
			<div className="border-t border-neutral-800 px-3 py-2 text-center text-[12px] text-neutral-500">
				只读观察 — 接管后可操作
			</div>
		);
	}

	return (
		<div className="shrink-0 border-t border-neutral-800">
			{/* Model / thinking controls (live sessions only). */}
			{live?.alive && !compact && (
				<div className="flex items-center gap-2 px-3 pt-1.5 text-[11px] text-neutral-500">
					<select
						value={current.value}
						onFocus={() => void loadModels()}
						onChange={(e) => {
							const payload = buildSetModelPayload(e.target.value, models);
							if (payload) {
								void rpcSend(sessionId, payload).then(() => {
									void rpcSend(sessionId, { type: "get_state" });
								});
							}
						}}
						className="max-w-44 truncate rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-neutral-400"
					>
						{!current.value && <option value="">模型…</option>}
						{current.value &&
							!models?.some(
								(m) => toModelKey(m.provider, m.id) === current.value,
							) && (
								<option value={current.value}>{current.label}</option>
							)}
						{(models ?? []).map((m) => {
							const key = toModelKey(m.provider, m.id);
							return (
								<option key={key} value={key}>
									{m.name}
								</option>
							);
						})}
					</select>
					<select
						value={currentThinking ?? ""}
						onChange={(e) =>
							void rpcSend(sessionId, {
								type: "set_thinking_level",
								level: e.target.value,
							})
						}
						className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-neutral-400"
					>
						{!currentThinking && <option value="">思考…</option>}
						{THINKING_LEVELS.map((l) => (
							<option key={l} value={l}>
								思考 {l}
							</option>
						))}
					</select>
					{held.length > 0 && (
						<span className="ml-auto flex items-center gap-1 text-amber-400">
							<CornerDownRight size={11} /> 暂存 {held.length}
						</span>
					)}
				</div>
			)}

			{/* Annotation pills. */}
			{annotations.length > 0 && (
				<div className="flex flex-wrap gap-1 px-3 pt-2">
					{annotations.map((a, i) => (
						<span
							key={a.id}
							title={a.text}
							className="flex max-w-52 items-center gap-1 rounded-full border border-neutral-700 bg-neutral-800/70 px-2 py-0.5 text-[11px] text-neutral-300"
						>
							[{i + 1}] {a.file ?? a.source}
							{a.lines ? ` ${a.lines}` : ""}
							<button
								type="button"
								onClick={() => removeAnnotation(sessionId, a.id)}
								className="text-neutral-500 hover:text-neutral-200"
							>
								<X size={10} />
							</button>
						</span>
					))}
				</div>
			)}

			<div className="relative px-3 py-2">
				{/* Slash-command menu. */}
				{menu.length > 0 && slashMatch && (
					<div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-lg">
						{menu.map((c, i) => (
							<button
								key={c.name}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									setText(`/${c.name} `);
									taRef.current?.focus();
								}}
								className={clsx(
									"flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-[12px]",
									i === menuIndex
										? "bg-neutral-800 text-neutral-100"
										: "text-neutral-300",
								)}
							>
								<span className="font-mono text-indigo-300">/{c.name}</span>
								{c.hint && <span className="text-neutral-500">{c.hint}</span>}
								<span className="truncate text-neutral-500">{c.description}</span>
							</button>
						))}
					</div>
				)}
				<textarea
					ref={taRef}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					rows={compact ? 2 : 3}
					placeholder={
						streaming
							? "输入中… Enter 暂存，⌘Enter 立即插队"
							: "发消息… (/ 命令，/fork 侧聊)"
					}
					className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-2 text-[13px] text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-600"
				/>
				<div className="absolute bottom-3.5 right-5 flex gap-1">
					{streaming && (
						<button
							type="button"
							onClick={() => void abortTurn(sessionId)}
							title="停止当前回合"
							className="rounded-md bg-red-900/70 p-1.5 text-red-200 hover:bg-red-800"
						>
							<Square size={13} />
						</button>
					)}
					<button
						type="button"
						onClick={() => void submit(false)}
						disabled={busy || !text.trim()}
						title={streaming ? "暂存" : "发送"}
						className="rounded-md bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-40"
					>
						<Send size={13} />
					</button>
				</div>
			</div>
		</div>
	);
}
