import { useState } from "react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { Row, Stepper } from "../controls";
import { api, errorMessage } from "../../../core/api";
import { toast } from "../../../ui/Toast";

export function WebSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [provider, setProvider] = useState("searxng");
	const [endpoint, setEndpoint] = useState("https://searx.be");
	const [apiKey, setApiKey] = useState("");
	const [maxResults, setMaxResults] = useState(5);
	const [busy, setBusy] = useState(false);

	const handleSave = async (key: string, val: unknown) => {
		setBusy(true);
		try {
			await api("POST", "/left/settings/set", { key, value: val });
			toast("联网搜索设置已保存", { kind: "success" });
		} catch (e) {
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="联网搜索设置">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<Row name="搜索引擎服务商" hint="智能体调用 web_search 工具时使用的搜索源">
						<select
							aria-label="搜索引擎服务商"
							value={provider}
							disabled={busy}
							onChange={(e) => {
								setProvider(e.target.value);
								void handleSave("web.provider", e.target.value);
							}}
							className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-2.5 text-m-sm text-m-text"
						>
							<option value="searxng">SearXNG (开源自建 / 公共实例)</option>
							<option value="tavily">Tavily Search</option>
							<option value="perplexity">Perplexity Sonar</option>
							<option value="duckduckgo">DuckDuckGo</option>
							<option value="google">Google Custom Search</option>
						</select>
					</Row>

					<div className="space-y-1">
						<label className="text-m-xs font-medium text-m-text-3">服务接口地址 (Endpoint)</label>
						<input
							type="text"
							value={endpoint}
							disabled={busy}
							onChange={(e) => setEndpoint(e.target.value)}
							onBlur={() => void handleSave("web.endpoint", endpoint)}
							placeholder="如 https://searx.be"
							className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text font-m-mono"
						/>
					</div>

					<div className="space-y-1">
						<label className="text-m-xs font-medium text-m-text-3">API 密钥 (如果服务商需要)</label>
						<input
							type="password"
							value={apiKey}
							disabled={busy}
							onChange={(e) => setApiKey(e.target.value)}
							onBlur={() => void handleSave("web.apiKey", apiKey)}
							placeholder="tvly-... 或 pplx-..."
							className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text font-m-mono"
						/>
					</div>

					<Row name="每次检索最大结果数" hint="返回给模型的网页摘要引用数量">
						<Stepper
							label="每次检索最大结果数"
							value={maxResults}
							min={1}
							max={20}
							step={1}
							unit="条"
							disabled={busy}
							onCommit={(v) => {
								setMaxResults(v);
								void handleSave("web.maxResults", v);
							}}
						/>
					</Row>
				</div>
			</div>
		</BottomSheet>
	);
}
