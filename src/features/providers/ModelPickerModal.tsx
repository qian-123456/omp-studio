import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { SearchInput } from "../../components/SearchInput";
import type { DiscoveredModel } from "../../lib/contracts";

interface Props {
	models: DiscoveredModel[];
	existingModelIds: Set<string>;
	onClose: () => void;
	onAppend: (selectedIds: string[]) => void;
	onReplace: (selectedIds: string[]) => void;
}

const inputCls =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none transition-all";

export function ModelPickerModal({
	models,
	existingModelIds,
	onClose,
	onAppend,
	onReplace,
}: Props) {
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return models;
		return models.filter(
			(m) =>
				m.id.toLowerCase().includes(term) ||
				(m.name && m.name.toLowerCase().includes(term)),
		);
	}, [models, search]);

	const handleToggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		setSelected(new Set(filtered.map((m) => m.id)));
	};

	const handleDeselectAll = () => {
		setSelected(new Set());
	};

	const handleAppend = () => {
		const toAppend = Array.from(selected).filter((id) => !existingModelIds.has(id));
		onAppend(toAppend);
	};

	const handleReplace = () => {
		onReplace(Array.from(selected));
	};

	return (
		<Modal
			onClose={onClose}
			title={`从供应商获取模型（已发现 ${models.length} 个模型）`}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="space-y-3 border-b border-[var(--border-divider)] p-4">
					<SearchInput
						value={search}
						onChange={setSearch}
						autoFocus
						placeholder="搜索模型 ID 或名称"
						inputClassName={`${inputCls} pl-8 pr-7`}
					/>

						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleSelectAll}
									className="rounded px-2 py-1 text-xs text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] active:scale-95 transition-all"
								>
									全选
								</button>
								<button
									type="button"
									onClick={handleDeselectAll}
									className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
								>
									取消全选
								</button>
							</div>
							<div className="text-xs font-medium text-neutral-400">
								已选 {selected.size} / {filtered.length} 个
							</div>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto p-4">
						{filtered.length === 0 ? (
							<div className="flex h-full items-center justify-center text-xs text-neutral-500">
								{search.trim() ? "未找到匹配的模型" : "未发现任何模型"}
							</div>
						) : (
							<div className="space-y-1">
								{filtered.map((model) => {
									const isSelected = selected.has(model.id);
									const isExisting = existingModelIds.has(model.id);
									return (
										<button
											key={model.id}
											type="button"
											onClick={() => handleToggle(model.id)}
											className="w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] active:scale-[0.99] transition-all"
										>
											<div
												className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-all ${
													isSelected
														? "border-[var(--accent)] bg-[var(--accent)]"
														: "hairline bg-[var(--well-bg)]"
												}`}
											>
												{isSelected && (
													<svg
														className="h-2.5 w-2.5 text-white"
														viewBox="0 0 12 12"
														fill="none"
													>
														<path
															d="M10 3L4.5 8.5L2 6"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-mono text-xs font-medium text-neutral-200 break-all">
														{model.id}
													</span>
													{isExisting && (
														<span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
															已添加
														</span>
													)}
												</div>
												{model.name && model.name !== model.id && (
													<div className="mt-0.5 text-[11px] text-neutral-400 break-all">
														{model.name}
													</div>
												)}
											</div>
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
					>
						取消
					</button>
					<button
						type="button"
						disabled={selected.size === 0}
						onClick={handleAppend}
						className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95 disabled:opacity-40 transition-all"
					>
						追加到列表
					</button>
					<button
						type="button"
						disabled={selected.size === 0}
						onClick={handleReplace}
						className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
					>
						覆盖当前列表
					</button>
				</div>
		</Modal>
	);
}
