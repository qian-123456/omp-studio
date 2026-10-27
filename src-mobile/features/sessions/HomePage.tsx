import { ArrowUp, Menu, Mic, Plus, Sparkles } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { useConnection } from "../../core/stores/connection";
import { useSessions } from "../../core/stores/sessions";
import { HeaderButton, PageHeader, Spinner, toast } from "../../ui";
import { draftBook } from "../chat/lib/drafts";
import { MenuSheet } from "./MenuSheet";
import { NewSessionSheet } from "./NewSessionSheet";
import { startTodosSync } from "./todos";
import { startTreeSync, useTree } from "./treeStore";
import type { DirEntry } from "./tree";

const CONN_LABEL: Record<string, string> = {
	open: "已连接",
	connecting: "连接中",
	closed: "重连中",
	idle: "连接中",
	unauthorized: "未授权",
};

const SUGGESTIONS = [
	"解释项目架构",
	"检查最近代码变更",
	"运行测试用例",
	"查找潜在的 bug",
];

export function HomePage(_props: PageProps) {
	const [newOpen, setNewOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const phase = useConnection((s) => s.phase);

	useEffect(() => {
		void useTree.getState().load();
		const offTree = startTreeSync();
		const offTodos = startTodosSync();
		return () => {
			offTree();
			offTodos();
		};
	}, []);

	const handleSend = async (textToSend?: string) => {
		const text = (textToSend ?? input).trim();
		if (!text || sending) return;
		setSending(true);

		try {
			// Resolve directory from /left/dirs
			const res = await api<{ dirs: DirEntry[] }>("GET", "/left/dirs");
			const dirs = res.dirs ?? [];
			const currentMode = useTree.getState().mode;
			const matchedDir =
				dirs.find((d) => d.kind === "workspace" && d.mode === currentMode) ??
				dirs.find((d) => d.kind === "workspace") ??
				dirs[0];

			if (!matchedDir?.path) {
				toast("未找到可用目录，请先在左侧菜单或设置中添加工作区", { kind: "error" });
				setSending(false);
				return;
			}

			// Create draft session instantly
			const { id } = await useSessions.getState().createSession({
				cwd: matchedDir.path,
				mode: matchedDir.kind === "global" ? "chat" : matchedDir.mode ?? currentMode,
			});

			setInput("");

			// Try to hand off first message directly through prompt-ex for immediate turn start
			try {
				const promptRes = await api<{ sessionId?: string }>("POST", `/sessions/${id}/prompt-ex`, {
					text,
					images: [],
				});
				const targetId = promptRes?.sessionId || id;
				draftBook.handoff(id, targetId, text);
				nav.push(paths.chat(targetId));
			} catch {
				// Fallback to stashing unsent prompt in draft
				draftBook.stash(id, text, []);
				nav.push(paths.chat(id));
			}
		} catch (e) {
			toast(`创建会话失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	return (
		<div className="relative flex min-h-0 flex-1 flex-col bg-m-bg">
			{/* Top bar with menu button and connection indicator */}
			<PageHeader
				title="omp-workspace"
				subtitle={CONN_LABEL[phase] ?? ""}
				onBack={false}
				left={<HeaderButton icon={<Menu size={22} />} label="菜单" onClick={() => setMenuOpen(true)} />}
				right={
					<button
						type="button"
						onClick={() => setNewOpen(true)}
						className="flex min-h-9 items-center gap-1 whitespace-nowrap rounded-m-pill border border-m-border px-3 text-m-sm font-medium active:bg-m-surface-hover"
					>
						<Plus size={16} />
						新建
					</button>
				}
			/>

			{/* Neutral welcome page body */}
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
				<div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-m-surface text-m-accent shadow-xs">
					<Sparkles size={32} />
				</div>
				<h1 className="text-m-fs-title font-semibold tracking-tight text-m-text">
					今天想做点什么？
				</h1>
				<p className="mt-2 max-w-xs text-m-sm text-m-text-3">
					随时发起新对话、解决编码问题或从左侧菜单管理工程
				</p>

				{/* Quick prompt suggestion chips */}
				<div className="mt-8 flex flex-wrap justify-center gap-2">
					{SUGGESTIONS.map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => void handleSend(s)}
							disabled={sending}
							className="inline-flex min-h-9 items-center rounded-m-pill border border-m-border bg-m-surface px-3 text-m-xs font-medium text-m-text-2 transition-colors active:bg-m-surface-hover"
						>
							{s}
						</button>
					))}
				</div>
			</div>

			{/* Bottom pill composer with + and send/mic */}
			<div
				className="shrink-0 px-4"
				style={{ paddingBottom: "max(12px, var(--m-safe-bottom))" }}
			>
				<div className="flex min-h-12 items-center gap-2 rounded-m-pill border border-m-border bg-m-composer-bg px-2 py-1 shadow-sm">
					{/* Left + button */}
					<button
						type="button"
						aria-label="新建会话选项"
						onClick={() => setNewOpen(true)}
						disabled={sending}
						className="flex size-10 shrink-0 items-center justify-center rounded-full text-m-text-2 active:bg-m-surface-hover disabled:opacity-50"
					>
						<Plus size={20} />
					</button>

					{/* Text input */}
					<input
						type="text"
						value={input}
						disabled={sending}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="今天想做点什么？"
						className="min-w-0 flex-1 bg-transparent px-1 text-m-md text-m-text placeholder:text-m-text-3 outline-none"
					/>

					{/* Right send / mic buttons */}
					{input.trim() === "" ? (
						<button
							type="button"
							aria-label="语音输入"
							onClick={() => toast("请在输入框键入消息或点击 ＋ 新建会话", { kind: "info" })}
							disabled={sending}
							className="flex size-10 shrink-0 items-center justify-center rounded-full text-m-text-2 active:bg-m-surface-hover disabled:opacity-50"
						>
							<Mic size={20} />
						</button>
					) : (
						<button
							type="button"
							aria-label="发送消息"
							onClick={() => void handleSend()}
							disabled={sending}
							className="flex size-10 shrink-0 items-center justify-center rounded-full bg-m-accent text-m-accent-text active:opacity-80 disabled:opacity-50"
						>
							{sending ? <Spinner size={16} /> : <ArrowUp size={18} />}
						</button>
					)}
				</div>
			</div>

			{/* Left navigation sheet & New session sheet */}
			<MenuSheet
				open={menuOpen}
				onClose={() => setMenuOpen(false)}
				onNewSession={() => setNewOpen(true)}
			/>
			<NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} />
		</div>
	);
}
