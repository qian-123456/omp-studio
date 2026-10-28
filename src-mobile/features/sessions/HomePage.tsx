import { FolderOpen, Lightbulb, Monitor, Paperclip, PenLine, Target } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths, type PageProps } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { AppMark, BottomSheet, MenuRow, Switch, toast } from "../../ui";
import { ChatHeader } from "../chat/components/ChatHeader";
import { ActionTile } from "../chat/components/Composer";
import { ComposerCapsule, type ComposerApi } from "../chat/components/ComposerCapsule";
import { ModelThinkingSheet } from "../chat/components/ModelThinkingSheet";
import type { ModelSource } from "../chat/components/useModelFacts";
import { draftBook, queueComposerAction, queueFirstSend, type ComposerAction } from "../chat/lib/drafts";
import { parseModelRef, type ModelFacts, type ModelOpt } from "../chat/lib/models";
import { MenuSheet } from "./MenuSheet";
import { NewSessionSheet } from "./NewSessionSheet";
import { startTodosSync } from "./todos";
import { startTreeSync, useTree } from "./treeStore";
import type { DirEntry } from "./tree";

export function HomePage(_props: PageProps) {
	const [newOpen, setNewOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [plusOpen, setPlusOpen] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const [sending, setSending] = useState(false);
	const [facts, setFacts] = useState<ModelFacts>({ current: null, thinkingLevel: null, liveThinking: [] });
	const selection = useRef<ModelOpt | null>(null);
	const factsRef = useRef(facts);
	factsRef.current = facts;
	const apiRef = useRef<ComposerApi | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const creating = useRef<Promise<string> | null>(null);
	const modelSource = useMemo<ModelSource>(() => ({
		load: async () => {
			const r = await api<{ models?: ModelOpt[] }>("GET", "/left/roles");
			return { ...factsRef.current, models: r.models ?? [] };
		},
		setModel: async (m) => {
			selection.current = m;
			const next = { current: { provider: m.provider, id: m.id }, thinkingLevel: null, liveThinking: m.thinking ?? [] };
			setFacts(next);
			return next;
		},
		setThinking: async (level) => {
			const next = { ...factsRef.current, thinkingLevel: level };
			setFacts(next);
			return next;
		},
	}), []);

	useEffect(() => {
		void useTree.getState().load();
		const offTree = startTreeSync();
		const offTodos = startTodosSync();
		return () => {
			offTree();
			offTodos();
		};
	}, []);

	useEffect(() => {
		let alive = true;
		void api<{ defaultModel?: string | null }>("GET", "/left/settings").then((r) => {
			const ref = parseModelRef(r.defaultModel);
			if (alive && ref && !selection.current) setFacts({ current: { provider: ref.provider, id: ref.id }, thinkingLevel: ref.thinking, liveThinking: [] });
		}).catch(() => {});
		return () => { alive = false; };
	}, []);

	const ensureDraft = (): Promise<string> => {
		if (creating.current) return creating.current;
		creating.current = (async () => {
			const res = await api<{ dirs: DirEntry[] }>("GET", "/left/dirs");
			const dirs = res.dirs ?? [];
			const mode = useTree.getState().mode;
			const dir = dirs.find((d) => d.kind === "workspace" && d.mode === mode) ?? dirs.find((d) => d.kind === "workspace") ?? dirs[0];
			if (!dir?.path) throw new Error("未找到可用目录，请先在菜单或设置中添加工作区");
			const model = selection.current;
			const level = factsRef.current.thinkingLevel;
			const { id } = await useSessions.getState().createSession({ cwd: dir.path, mode: dir.kind === "global" ? "chat" : dir.mode ?? mode, ...(model ? { model: { provider: model.provider, modelId: model.id } } : {}), ...(level ? { thinking: level } : {}) });
			return id;
		})().catch((e) => { creating.current = null; throw e; });
		return creating.current;
	};

	const handleSend = async (value: string) => {
		const text = value.trim();
		if (!text || sending) return;
		setSending(true);
		try {
			const id = await ensureDraft();
			queueFirstSend(id, text);
			apiRef.current?.clear();
			nav.replace(paths.chat(id));
		} catch (e) {
			toast(`创建会话失败：${errorMessage(e)}`, { kind: "error" });
		} finally { setSending(false); }
	};

	const openAction = async (action?: ComposerAction, files?: File[]) => {
		if (sending) return;
		setPlusOpen(false);
		setSending(true);
		try {
			const id = await ensureDraft();
			draftBook.stash(id, apiRef.current?.get() ?? "", []);
			queueComposerAction(id, action, files);
			nav.replace(paths.chat(id));
		} catch (e) {
			toast(`创建会话失败：${errorMessage(e)}`, { kind: "error" });
		} finally { setSending(false); }
	};

	return (
		<div className="relative flex min-h-0 flex-1 flex-col bg-m-bg">
			<div className="pointer-events-none absolute inset-0" style={{ background: "var(--m-glow)" }} aria-hidden />
			<ChatHeader model={facts.current?.id} thinking={facts.thinkingLevel} onMenu={() => setMenuOpen(true)} onModel={() => setModelOpen(true)} onNew={() => setNewOpen(true)} />
			<div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-5 pb-12 text-center">
				<AppMark size={40} />
				<h1 className="text-m-display font-normal text-m-text">今天想做点什么？</h1>
			</div>
			<div className="relative shrink-0 px-4" style={{ paddingBottom: "max(12px, var(--m-safe-bottom))" }}>
				<ComposerCapsule apiRef={apiRef} placeholder="今天想做点什么？" busy={sending} onPlus={() => setPlusOpen(true)} onSend={(text) => void handleSend(text)} />
			</div>
			<input ref={fileRef} type="file" multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void openAction(undefined, files); }} />
			<BottomSheet open={plusOpen} onClose={() => setPlusOpen(false)}>
				<div className="grid grid-cols-3 gap-3 px-4 pt-1">
					<ActionTile icon={<Paperclip size={24} />} label="文件" onClick={() => fileRef.current?.click()} />
					<ActionTile icon={<Monitor size={24} />} label="Finder 选中项" onClick={() => void openAction("finder")} />
					<ActionTile icon={<PenLine size={24} />} label="草图" onClick={() => void openAction("sketch")} />
				</div>
				<div className="pt-3 pb-3">
					<MenuRow icon={<FolderOpen size={22} />} label="在项目中工作" hint="选择项目目录" onClick={() => void openAction("workspace")} />
					<MenuRow icon={<Target size={22} />} label="目标" hint="设定后会持续朝它推进" onClick={() => void openAction("goal")} />
					<div className="flex min-h-13 items-center gap-4 py-1 pr-4 pl-5"><Lightbulb size={22} className="shrink-0 text-m-text-2" /><span className="flex-1 whitespace-nowrap text-m-md">规划模式</span><Switch label="规划模式" checked={false} onChange={() => void openAction("plan")} /></div>
				</div>
			</BottomSheet>
			<MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} onNewSession={() => setNewOpen(true)} />
			<NewSessionSheet open={newOpen} onClose={() => setNewOpen(false)} />
			<ModelThinkingSheet open={modelOpen} onClose={() => setModelOpen(false)} source={modelSource} currentLevel={facts.thinkingLevel} onFacts={(next) => setFacts(next)} />
		</div>
	);
}
