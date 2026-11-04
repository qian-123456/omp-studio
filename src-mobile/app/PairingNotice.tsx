import { useEffect, useState } from "react";
import { api, errorMessage } from "../core/api";
import { useConnection } from "../core/stores/connection";
import { Button } from "../ui/Button";

/** A successful pairing is usable immediately; naming is optional. */
export function PairingNotice() {
	const unauthorized = useConnection((state) => state.phase === "unauthorized");
	const [visible, setVisible] = useState(true);
	const [name, setName] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		void api<{ name: string }>("GET", "/device", undefined, { signal: controller.signal }).then((device) => {
			setName(device.name);
			setDraft(device.name);
		}).catch((e: unknown) => {
			if (!controller.signal.aborted) setError(errorMessage(e, "无法读取设备名称"));
		});
		return () => controller.abort();
	}, []);

	const save = async () => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await api("POST", "/device/name", { name: draft.trim() });
			const device = await api<{ name: string }>("GET", "/device");
			setName(device.name);
			setDraft(device.name);
			setEditing(false);
		} catch (e) {
			setError(errorMessage(e, "保存失败"));
		} finally {
			setSaving(false);
		}
	};
	if (!visible || unauthorized) return null;
	return (
		<section aria-label="配对成功" className="mx-4 my-2 rounded-m-md bg-m-surface px-4 py-3 text-m-sm text-m-text">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0"><strong>配对成功</strong><p className="break-words text-m-text-2">{name === null ? (error ? "设备名称暂不可用" : "正在读取设备名称…") : `设备名称：${name}`}</p></div>
				<button type="button" onClick={() => setVisible(false)} className="min-h-11 shrink-0 px-2 text-m-text-2">关闭</button>
			</div>
			{editing ? (
				<form onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-wrap items-end gap-2">
					<label className="min-w-0 flex-1">设备名称（可选）<input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={120} className="mt-1 w-full rounded-m-md bg-m-bg px-3 py-2 text-m-text" /></label>
					<Button type="submit" busy={saving}>保存</Button>
					<Button onClick={() => setEditing(false)}>取消</Button>
				</form>
			) : <Button size="sm" onClick={() => setEditing(true)}>修改名称</Button>}
			{error && <p role="alert" className="mt-2 break-words text-m-danger">{error}</p>}
		</section>
	);
}
