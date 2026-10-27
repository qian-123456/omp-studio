import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { toast } from "../../../ui/Toast";

interface SecretItem {
	id: string;
	label: string;
	placeholder: string;
	hidden?: boolean;
}

const INITIAL_SECRETS: SecretItem[] = [
	{ id: "1", label: "OpenAI API Key", placeholder: "[SECRET_OPENAI_KEY]" },
	{ id: "2", label: "GitHub Access Token", placeholder: "[SECRET_GITHUB_TOKEN]" },
];

export function PrivacySheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [secrets, setSecrets] = useState<SecretItem[]>(INITIAL_SECRETS);
	const [showAdd, setShowAdd] = useState(false);
	const [newLabel, setNewLabel] = useState("");
	const [newValue, setNewValue] = useState("");

	const handleAdd = () => {
		if (!newLabel.trim()) return;
		const placeholder = `[SECRET_${newLabel.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")}]`;
		setSecrets((prev) => [
			...prev,
			{
				id: String(Date.now()),
				label: newLabel.trim(),
				placeholder,
			},
		]);
		setNewLabel("");
		setNewValue("");
		setShowAdd(false);
		toast("已添加脱敏保护项", { kind: "success" });
	};

	const handleDelete = (id: string) => {
		setSecrets((prev) => prev.filter((s) => s.id !== id));
		toast("已移除脱敏项", { kind: "info" });
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="隐私设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center justify-between">
						<div>
							<h3 className="text-m-sm font-semibold text-m-text">敏感数据上游脱敏保护</h3>
							<p className="mt-0.5 text-m-xs text-m-text-3">
								对话中包含的真实密钥或密码在发送给模型前，会自动替换为占位符。
							</p>
						</div>
						<button
							type="button"
							onClick={() => setShowAdd(!showAdd)}
							className="flex items-center gap-1 rounded-m-md border border-m-border bg-m-surface px-2.5 py-1 text-m-xs font-medium text-m-text"
						>
							<Plus size={14} />
							添加
						</button>
					</div>

					{showAdd && (
						<div className="rounded-m-md border border-m-border bg-m-surface p-3 space-y-2.5">
							<div className="text-m-xs font-medium text-m-text">新建脱敏项</div>
							<input
								type="text"
								placeholder="标签名称（如 AWS_SECRET_KEY）"
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
								className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
							/>
							<input
								type="password"
								placeholder="敏感真实内容（本地比对用）"
								value={newValue}
								onChange={(e) => setNewValue(e.target.value)}
								className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
							/>
							<div className="flex justify-end gap-2 pt-1">
								<button
									type="button"
									onClick={() => setShowAdd(false)}
									className="min-h-9 rounded-m-md px-3 text-m-xs text-m-text-3"
								>
									取消
								</button>
								<button
									type="button"
									onClick={handleAdd}
									className="min-h-9 rounded-m-md bg-m-accent px-3 text-m-xs font-medium text-m-accent-text"
								>
									保存脱敏
								</button>
							</div>
						</div>
					)}

					<div className="divide-y divide-m-border">
						{secrets.map((s) => (
							<div key={s.id} className="flex items-center justify-between py-2.5">
								<div className="min-w-0 pr-2">
									<div className="text-m-sm font-medium text-m-text">{s.label}</div>
									<div className="font-m-mono text-m-xs text-m-text-3">{s.placeholder}</div>
								</div>
								<button
									type="button"
									aria-label={`删除 ${s.label}`}
									onClick={() => handleDelete(s.id)}
									className="flex h-9 w-9 items-center justify-center rounded-m-md text-m-danger hover:bg-m-danger/10"
								>
									<Trash2 size={16} />
								</button>
							</div>
						))}
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
