/** [providers] Presentation + click behavior of a provider row's key state (the merged 密钥 column). */

import type { ProviderRow } from "../../lib/contracts";

export type KeyTone = "success" | "warning" | "error" | "info" | "muted";

/** What clicking the key status does. `none` = plain, non-interactive text. */
export type KeyAction =
	| "decrypt"
	| "encrypt"
	| "setKey"
	| "oauth"
	| "explainLogin"
	| "none";

export interface KeyPresentation {
	label: string;
	tone: KeyTone;
	action: KeyAction;
	/** Tooltip: says what a click does (or why nothing happens). */
	title: string;
}

export const VAULT_PATH = "~/.omp-workspace/env/keys.env";
export const MODELS_YML_PATH = "~/.omp/agent/models.yml";
export const AGENT_DB_PATH = "~/.omp/agent/agent.db";

export const LOGIN_STORED_NOTE =
	"这个供应商的密钥由 OMP 自己的登录保存（~/.omp/agent/agent.db），由 OMP 管理；暂不支持在这里加密。";

export function describeKey(row: Pick<ProviderRow, "key">): KeyPresentation {
	const { kind, envVar, envSet } = row.key;
	switch (kind) {
		case "encrypted":
			return {
				label: "已加密",
				tone: "success",
				action: "decrypt",
				title: "密钥已加密保存在工作台密钥库。点击可改回明文",
			};
		case "plaintext":
			return {
				label: "明文",
				tone: "warning",
				action: "encrypt",
				title: `密钥以明文保存在 ${MODELS_YML_PATH}。点击立即加密`,
			};
		case "vaultMissing":
			return {
				label: "加密密钥丢失",
				tone: "error",
				action: "setKey",
				title: "密钥库里找不到这个供应商的密钥。点击重新设置密钥",
			};
		case "envVar": {
			const name = envVar ?? "";
			const set = envSet === true;
			return {
				label: set ? "环境变量" : "环境变量未设置",
				tone: set ? "info" : "warning",
				action: "setKey",
				title: `密钥取自环境变量 ${name}（${set ? "已设置" : "未设置"}）。点击可直接设置密钥`,
			};
		}
		case "missing":
			return {
				label: "未配置密钥",
				tone: "warning",
				action: "setKey",
				title: "还没有密钥。点击设置密钥",
			};
		case "oauth":
			return {
				label: "OAuth 登录",
				tone: "info",
				action: "oauth",
				title: "通过账号登录。点击管理账号",
			};
		case "loginStored":
			return {
				label: "OMP 登录保存",
				tone: "info",
				action: "explainLogin",
				title: "密钥由 OMP 的登录保存。点击查看说明",
			};
		case "none":
			return {
				label: "无需密钥",
				tone: "muted",
				action: "none",
				title: "这个供应商不需要密钥",
			};
		case "command":
			return {
				label: "命令获取",
				tone: "muted",
				action: "none",
				title: "密钥由 models.yml 中的命令获取，由你自己管理",
			};
	}
}

export interface AuthBadge {
	label: string;
	tone: KeyTone;
}

export function authBadge(row: Pick<ProviderRow, "key">): AuthBadge {
	switch (row.key.kind) {
		case "oauth":
			return { label: "OAuth", tone: "info" };
		case "none":
			return { label: "无密钥", tone: "muted" };
		default:
			return { label: "API Key", tone: "success" };
	}
}

/** One-line "where does the key live" text for the expanded row. */
export function keyLocation(row: Pick<ProviderRow, "key">): string {
	switch (row.key.kind) {
		case "encrypted":
			return `${VAULT_PATH}（AES-GCM 加密，models.yml 里只有读取命令）`;
		case "plaintext":
			return MODELS_YML_PATH;
		case "oauth":
		case "loginStored":
			return AGENT_DB_PATH;
		case "envVar":
			return `环境变量 ${row.key.envVar ?? ""}（${row.key.envSet ? "已设置" : "未设置"}）`;
		case "command":
			return `${MODELS_YML_PATH} 中的命令`;
		case "vaultMissing":
			return `${MODELS_YML_PATH} 引用了密钥库条目，但 ${VAULT_PATH} 里没有`;
		case "none":
			return "无需密钥";
		case "missing":
			return "未配置";
	}
}

export const keyToneClass: Record<KeyTone, string> = {
	success: "text-emerald-400",
	warning: "text-amber-400",
	error: "text-rose-400",
	info: "text-sky-300",
	muted: "text-neutral-500",
};

/** Host (with port) of a base URL, or the trimmed text when it does not parse. */
export function hostOf(rawUrl: string | null | undefined): string | null {
	const trimmed = rawUrl?.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).host || trimmed;
	} catch {
		return trimmed;
	}
}
