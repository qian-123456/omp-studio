/** Mutations behind the session list (ported from nav-left.js): create, patch, discard draft, batch archive, assign. */
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { useSessions } from "../../core/stores/sessions";
import { isDraftId } from "../../core/types";
import { confirm, toast } from "../../ui";
import { refreshAll, useTree } from "./treeStore";
import type { TreeSession } from "./tree";

const enc = encodeURIComponent;
const inflight = new Set<string>();

/** Contextual 「＋」: create directly in `cwd` and open the new session. */
export async function newSessionIn(cwd: string): Promise<void> {
	if (inflight.has(cwd)) return;
	inflight.add(cwd);
	try {
		const { id } = await useSessions.getState().createSession({ cwd });
		nav.push(paths.chat(id));
	} catch (e) {
		toast(`新建失败：${errorMessage(e)}`, { kind: "error" });
	} finally {
		inflight.delete(cwd);
	}
}

export async function patchSession(
	s: Pick<TreeSession, "id">,
	patch: { customName?: string; pinned?: boolean; archived?: boolean; workspaceId?: string },
	okText?: string,
): Promise<void> {
	try {
		await api("PATCH", `/left/sessions/${enc(s.id)}`, patch);
		if (okText) toast(okText, { kind: "success" });
		await refreshAll();
	} catch (e) {
		toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
	}
}

export async function discardDraft(s: Pick<TreeSession, "id">): Promise<void> {
	if (!(await confirm({ message: "丢弃这个未发送的草稿？", confirmText: "丢弃", danger: true }))) return;
	try {
		await api("POST", `/left/drafts/${enc(s.id)}/discard`);
		await refreshAll();
	} catch (e) {
		toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
	}
}

/** Archive every non-archived session of a group; drafts are discarded instead (they cannot be archived). */
export async function batchArchive(title: string, sessions: readonly TreeSession[]): Promise<void> {
	const list = sessions.filter((s) => !s.archived);
	if (!list.length) {
		toast("该分组下无需要归档的会话");
		return;
	}
	if (!(await confirm({ message: `确定批量归档「${title}」下的 ${list.length} 个会话？`, confirmText: "归档", danger: true }))) return;
	const rs = await Promise.allSettled(
		list.map((s) =>
			isDraftId(s.id)
				? api("POST", `/left/drafts/${enc(s.id)}/discard`)
				: api("PATCH", `/left/sessions/${enc(s.id)}`, { archived: true }),
		),
	);
	const fail = rs.filter((r) => r.status === "rejected").length;
	toast(fail ? `已归档 ${list.length - fail} 个，${fail} 个失败` : `已归档 ${list.length} 个会话`, {
		kind: fail ? "error" : "success",
	});
	await refreshAll();
}

export async function assignToWorkspace(sessions: readonly TreeSession[], workspaceId: string): Promise<void> {
	const rs = await Promise.allSettled(sessions.map((s) => api("PATCH", `/left/sessions/${enc(s.id)}`, { workspaceId })));
	const fail = rs.filter((r) => r.status === "rejected").length;
	toast(
		fail === sessions.length ? "更新工作区归属失败" : fail ? `已更新 ${sessions.length - fail} 个，${fail} 个失败` : "已更新工作区归属",
		{ kind: fail ? "error" : "success" },
	);
	await refreshAll();
}

export async function addWorkspace(cwd: string, label: string): Promise<void> {
	try {
		await api("POST", "/left/workspaces", { path: cwd });
		toast(`已添加工作区「${label}」`, { kind: "success" });
		await useTree.getState().load();
	} catch (e) {
		toast(`添加工作区失败：${errorMessage(e)}`, { kind: "error" });
	}
}
