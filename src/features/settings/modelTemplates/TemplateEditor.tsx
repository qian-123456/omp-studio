/**
 * [D] Settings ▸ 模板与自动切换: create/edit one role→model template.
 *
 * Every built-in role plus the custom roles already known to any template is
 * listed with one `ModelSelect`: a model, 「未配置」 (stores `null`, so apply
 * deletes that role's global key and restores inheritance) or 「保持当前」 (the
 * key stays out of the template, so apply leaves that role alone). Only the
 * bottom line flag is globally exclusive, and the backend enforces it.
 */
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../../components/FloatingLayer";
import { ModelSelect } from "../../../components/ModelSelect";
import type { ModelTemplate, ModelTemplateInput } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { claimEscape } from "../../../lib/escapeClaim";
import { isComposing } from "../../../lib/hooks";
import { modelTemplateSave } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useModelOptions } from "../../../stores/modelCatalog";
import { BUILTIN_ROLES } from "../modelRoles";
import { Switch } from "../Switch";
import { Button, Chip, IconButton, INPUT_CLASS, MODEL_PICKER_BUTTON_CLASS, Notice } from "../ui";
import { GLOBAL_SCOPE } from "./logic";
import { useModelTemplatesStore } from "./store";

/** Picker sentinel: declare the role as `null` (apply deletes the global key). */
const UNSET = "__unset__";
/** Picker sentinel: leave the key out of the template (apply keeps the current value). */
const ABSENT = "__absent__";
const ABSENT_LABEL = "保持当前";

const BUILTIN_IDS = new Set(BUILTIN_ROLES.map((r) => r.id));

const UNSET_BUTTON_CLASS = `${MODEL_PICKER_BUTTON_CLASS} italic text-[var(--text-muted)]`;

interface RoleRow {
	id: string;
	label: string;
	description: string;
	isCustom: boolean;
}

export interface TemplateDraft {
	/** `null` for a new template. */
	id: string | null;
	/** Scope the template belongs to; fixed once saved. */
	scope: string;
	name: string;
	roles: Record<string, string | null>;
	isBottomLine: boolean;
}

/** Editor state from an existing template. */
export function draftFromTemplate(template: ModelTemplate): TemplateDraft {
	return {
		id: template.id,
		scope: template.scope,
		name: template.name,
		roles: { ...template.roles },
		isBottomLine: template.isBottomLine,
	};
}

/** Editor state from a backend-captured draft (`modelTemplateCapture`). */
export function draftFromInput(input: ModelTemplateInput): TemplateDraft {
	return {
		id: input.id ?? null,
		scope: input.scope,
		name: input.name,
		roles: { ...input.roles },
		isBottomLine: input.isBottomLine,
	};
}

export function TemplateEditor({
	draft,
	templates,
	onClose,
}: {
	draft: TemplateDraft;
	templates: ModelTemplate[];
	onClose: () => void;
}) {
	const models = useModelOptions();
	const [name, setName] = useState(draft.name);
	const [roles, setRoles] = useState<Record<string, string | null>>(draft.roles);
	const [isBottomLine, setIsBottomLine] = useState(draft.isBottomLine);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const dialogRef = useRef<HTMLDivElement>(null);

	// Move focus into the dialog so Tab/Escape stay inside it.
	useEffect(() => {
		dialogRef.current?.focus();
	}, []);

	// Custom roles = non-built-in keys any template (or this draft) already knows.
	const rows = useMemo<RoleRow[]>(() => {
		const custom = new Set<string>();
		for (const t of templates) for (const key of Object.keys(t.roles)) if (!BUILTIN_IDS.has(key)) custom.add(key);
		for (const key of Object.keys(draft.roles)) if (!BUILTIN_IDS.has(key)) custom.add(key);
		return [
			...BUILTIN_ROLES.map((r) => ({
				id: r.id,
				label: r.zhLabel,
				description: r.description,
				isCustom: false,
			})),
			...[...custom].sort().map((id) => ({
				id,
				label: id,
				description: "自定义角色（模型角色中的非内置项）",
				isCustom: true,
			})),
		];
	}, [templates, draft.roles]);

	// A declared key counts as covered even when it is null (apply deletes that role).
	const uncovered = rows.filter((r) => !Object.prototype.hasOwnProperty.call(roles, r.id)).length;
	const otherBottomLine = templates.filter((t) => t.isBottomLine && t.id !== draft.id);
	const trimmedName = name.trim();
	const canSave = trimmedName.length > 0 && !saving;
	const isProject = draft.scope !== GLOBAL_SCOPE;

	const setRole = (roleId: string, value: string) => {
		setRoles((prev) => {
			const next = { ...prev };
			if (value === ABSENT) delete next[roleId];
			else if (value === UNSET) next[roleId] = null;
			else next[roleId] = value;
			return next;
		});
	};

	const save = async () => {
		if (!canSave) return;
		setSaving(true);
		setError(null);
		try {
			// The backend keeps `isBottomLine` unique per scope: saving it here clears the other templates of this scope.
			const snapshot = await modelTemplateSave({
				id: draft.id,
				name: trimmedName,
				roles,
				isBottomLine,
				scope: draft.scope,
			});
			useModelTemplatesStore.getState().setSnapshot(snapshot);
			toast.success(draft.id ? `已保存模板「${trimmedName}」` : `已新建模板「${trimmedName}」`);
			onClose();
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setSaving(false);
		}
	};

	return createPortal(
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-6 backdrop-blur-sm"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !saving) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-template-editor-title"
				tabIndex={-1}
				className="flex h-[min(86vh,760px)] w-[760px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-[var(--bg-panel)] p-4 text-[var(--text)] shadow-apple-modal hairline outline-none"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (isComposing(e)) return;
					if (e.key === "Escape") {
						claimEscape(e);
						if (!saving) onClose();
					}
				}}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] pb-3">
					<div className="min-w-0">
						<h2 id="model-template-editor-title" className="text-sm font-semibold text-[var(--text)]">
							{draft.id ? "编辑模板" : "新建模板"}
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-[var(--text-muted)]">
							每个角色选一个模型，或保持「未配置」。
							{isProject ? "应用模板时只改该项目的模型角色。" : "应用模板时只改全局模型角色。"}
						</p>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} disabled={saving} />
				</div>

				<div className="shrink-0 space-y-3 border-b border-[var(--border-divider)] py-3">
					<label className="flex flex-wrap items-center gap-2">
						<span className="text-xs font-medium text-[var(--text)]">模板名称</span>
						<input
							type="text"
							value={name}
							disabled={saving}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									void save();
								}
							}}
							placeholder="例如：省钱模式"
							aria-label="模板名称"
							spellCheck={false}
							className={`${INPUT_CLASS} w-64`}
						/>
						{trimmedName.length === 0 && (
							<span className="text-[11px] text-[var(--text-dim)]">名称不能为空</span>
						)}
					</label>

					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs font-medium text-[var(--text)]">保底模板</span>
							<Switch
								checked={isBottomLine}
								onChange={setIsBottomLine}
								disabled={saving}
								ariaLabel="设为保底模板"
							/>
							<span className="text-[11px] leading-4 text-[var(--text-muted)]">
								额度全用尽时也会应用；同一范围只能有一个保底模板
							</span>
						</div>
						<Chip tone={uncovered > 0 ? "warning" : "success"}>
							{uncovered > 0 ? `${uncovered} 个角色未覆盖` : "全部角色已覆盖"}
						</Chip>
					</div>

					{isBottomLine && otherBottomLine.length > 0 && (
						<Notice tone="info">
							<span className="break-words">
								保存后「{otherBottomLine.map((t) => t.name).join("」「")}」将不再是保底模板。
							</span>
						</Notice>
					)}
					{uncovered > 0 && (
						<Notice tone="info">
							<span className="break-words">
								未覆盖的角色在应用时保持当前配置不变；
								{isProject
									? "选择「未配置」会在应用时从该项目配置删除该角色，继承全局。"
									: "选择「未配置」会在应用时删除该角色的全局设置，恢复继承。"}
							</span>
						</Notice>
					)}
					{error && (
						<Notice tone="danger" title="保存失败">
							<span className="select-text break-all">{error}</span>
						</Notice>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto py-2">
					{rows.map((row) => {
						const declared = Object.prototype.hasOwnProperty.call(roles, row.id);
						const value = roles[row.id];
						const set = typeof value === "string" && value.length > 0;
						return (
							<div
								key={row.id}
								className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-hover)]"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="break-all font-mono text-xs font-semibold text-[var(--text)]">
											{row.id}
										</span>
										{row.isCustom ? (
											<Chip tone="accent">自定义</Chip>
										) : (
											<span className="text-[11px] text-[var(--text-muted)]">{row.label}</span>
										)}
										{set && <Check className="h-3 w-3 text-[var(--status-success)]" />}
										{declared && !set && <Chip tone="warning">应用时删除</Chip>}
									</div>
									<div className="text-[11px] leading-4 text-[var(--text-dim)]">{row.description}</div>
								</div>
								<ModelSelect
									models={models}
									label={set ? (value as string) : declared ? "未配置" : ABSENT_LABEL}
									currentValue={set ? (value as string) : declared ? UNSET : ABSENT}
									buttonClass={set ? MODEL_PICKER_BUTTON_CLASS : UNSET_BUTTON_CLASS}
									closeOnSelect
									allowCustom
									thinking
									align="end"
									widthClass="w-[380px]"
									disabled={saving}
									extras={[
										{ value: UNSET, label: "未配置", hint: "应用时删除该角色" },
										{ value: ABSENT, label: ABSENT_LABEL, hint: "应用时保持不变" },
									]}
									onSelect={(next) => setRole(row.id, next)}
								/>
							</div>
						);
					})}
				</div>

				<div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
					{saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-dim)]" />}
					<Button onClick={onClose} disabled={saving}>
						取消
					</Button>
					<Button variant="primary" onClick={() => void save()} disabled={!canSave} loading={saving}>
						保存模板
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
