/** [B] Right tab: side-chat forks of the selected session. */

import { GitBranch, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { createSideChat } from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SessionView } from "../chat/SessionView";

const MAX_DEPTH = 3;

export function SideChatPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	const sideChatRequest = useComposer((s) => s.sideChatRequest);
	const clearSideChatRequest = useComposer((s) => s.clearSideChatRequest);
	const [childId, setChildId] = useState<string | null>(null);
	const [question, setQuestion] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const parent = selectedId ? sessions[selectedId] : undefined;
	const children = Object.values(sessions)
		.filter((s) => s.parentId === selectedId)
		.sort((a, b) => a.label.localeCompare(b.label));
	const tooDeep = (parent?.forkDepth ?? 0) >= MAX_DEPTH;

	// Consume a pending side-chat request (selection toolbar / other features).
	useEffect(() => {
		if (!sideChatRequest || sideChatRequest.parentSessionId !== selectedId)
			return;
		clearSideChatRequest();
		// The selection is carried into createSideChat when the user hits send.
		setPendingSelection(sideChatRequest.selection ?? null);
	}, [sideChatRequest, selectedId, clearSideChatRequest]);

	const [pendingSelection, setPendingSelection] = useState<string | null>(null);

	useEffect(() => {
		setChildId(null);
		setPendingSelection(null);
		setError(null);
	}, [selectedId]);

	const create = async () => {
		const q = question.trim();
		if (!q || !selectedId || busy) return;
		setBusy(true);
		setError(null);
		try {
			const info = await createSideChat(
				selectedId,
				q,
				pendingSelection ?? undefined,
			);
			setQuestion("");
			setPendingSelection(null);
			setChildId(info.sessionId);
			void useSessions.getState().load().catch(() => {});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (!selectedId) {
		return (
			<div className="p-3 text-xs text-neutral-500">选择一个会话后可开侧聊</div>
		);
	}

	// Selected child → embedded compact SessionView.
	if (childId) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex shrink-0 items-center gap-1 border-b border-neutral-800 px-2 py-1">
					<button
						type="button"
						onClick={() => setChildId(null)}
						className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800"
					>
						← 返回列表
					</button>
					<button
						type="button"
						onClick={() => selectSession(childId)}
						className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-indigo-400 hover:bg-neutral-800"
					>
						在主视图打开
					</button>
				</div>
				<div className="min-h-0 flex-1">
					<SessionView sessionId={childId} compact />
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b border-neutral-800 px-3 py-2 text-[11px] text-neutral-500">
				{parent
					? `侧聊 · ${parent.label} ${parent.title}`
					: "侧聊"}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{children.length === 0 && (
					<div className="py-4 text-center text-[11px] text-neutral-600">
						还没有侧聊。选中正文文字可快速提问。
					</div>
				)}
				{children.map((c) => (
					<button
						key={c.id}
						type="button"
						onClick={() => setChildId(c.id)}
						className="mb-1 flex w-full items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 px-2 py-1.5 text-left hover:bg-neutral-800/60"
					>
						<GitBranch size={12} className="shrink-0 text-indigo-400" />
						<span className="shrink-0 font-mono text-[11px] text-indigo-300">
							{c.label}
						</span>
						<span className="min-w-0 flex-1 truncate text-[12px] text-neutral-300">
							{c.title}
						</span>
						<ChildStatus id={c.id} fallback={c.status} />
					</button>
				))}
			</div>
			<div className="shrink-0 border-t border-neutral-800 p-2">
				{tooDeep ? (
					<div className="text-center text-[11px] text-neutral-500">
						请开新主会话
					</div>
				) : (
					<>
						{pendingSelection && (
							<div className="mb-1 max-h-16 overflow-hidden truncate rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1 text-[10px] text-neutral-500">
								引用：{pendingSelection}
							</div>
						)}
						{error && (
							<div className="mb-1 text-[11px] text-red-400">{error}</div>
						)}
						<div className="flex gap-1">
							<input
								value={question}
								onChange={(e) => setQuestion(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void create();
								}}
								placeholder="新建侧聊：问点什么…"
								className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-[12px] text-neutral-200 outline-none focus:border-indigo-600"
							/>
							<button
								type="button"
								disabled={busy || !question.trim()}
								onClick={() => void create()}
								className="rounded-md bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-40"
							>
								<Send size={13} />
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function ChildStatus({
	id,
	fallback,
}: {
	id: string;
	fallback: string;
}) {
	const streaming = useLive((s) => s.sessions[id]?.streaming === true);
	const label = streaming ? "运行中" : fallback === "idle" ? "空闲" : fallback;
	return (
		<span className="shrink-0 text-[10px] text-neutral-500">{label}</span>
	);
}
