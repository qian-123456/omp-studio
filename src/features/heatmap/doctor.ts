/**
 * AI doctor (AI会诊): prompt building, output parsing and long-term
 * systemic-issue aggregation. Pure functions; no IO.
 */
import type {
	DiagnosticDiagnosisResult,
	DiagnosticLens,
	DiagnosticPrescription,
	SessionDiagnosticSkeleton,
} from "./distribution";

export interface DoctorTurn {
	role: "user" | "assistant";
	text: string;
	at: number;
}

export interface DoctorHistoryEntry {
	sessionId: string;
	cwd: string;
	model: string;
	tags: string[];
	at: number;
}

export interface SystemicIssue {
	scope: "cross-project" | "same-project" | "same-model";
	tag: string;
	count: number;
	sessionIds: string[];
	scopeLabel: string;
	hint: string;
}

const SYSTEM_ROLE = `你是一位资深的 AI 编程教练，服务对象是不会写代码、靠 AI 编程助手（Vibe Coding）完成项目的用户。
你只能看到下面这份「会话骨架」（已脱水的会话摘要），看不到原始对话；所有判断必须基于骨架中的事实，不得编造。`;

const LENS_FOCUS: Record<DiagnosticLens, string> = {
	cost: `【诊断视角：成本】重点排查：上下文浪费（无关大文件、长输出灌入上下文）、重复读取同一文件或重复触发同一技能、本可以拆给子代理并行或隔离的工作、会话过长导致上下文接近上限。`,
	prompt: `【诊断视角：提示词】重点排查：目标模糊、需求范围蔓延/过度设计（用户或助手不断加需求）、缺少验收标准、一次塞入多个不相关任务、关键约束没讲清导致返工。`,
	quality: `【诊断视角：质量】重点排查：报错重试死循环（同一错误反复撞墙）、近期未解决的报错、改动了高风险文件（配置、依赖、数据库、鉴权、构建脚本）、隐藏的代码风险（跳过测试、吞掉异常、临时补丁、未验证就宣称完成）。`,
	freeform: `【诊断视角：自由提问】围绕用户的问题作答，答案必须落在骨架中的具体事实上；同时指出与问题相关的范围蔓延、撞墙重试、隐藏风险或上下文浪费。`,
};

const OUTPUT_RULES = `输出要求（必须严格遵守）：
1. 只输出一个 JSON 对象，不要任何 JSON 以外的文字，字段如下：
{
  "conclusion": "一句话结论（中文，直指问题）",
  "evidence": ["引用骨架中的具体事实，如第几轮、哪个文件、哪条报错", "..."],
  "rootCause": "根因分析：为什么会这样，是用户提问方式、任务拆分还是助手行为导致",
  "prescriptions": [
    {"label": "处方短标题", "promptDraft": "可直接发给编程助手的完整指令", "explanation": "为什么这样做能解决问题"}
  ],
  "systemicTags": ["目标模糊"]
}
2. prescriptions 给 1-3 条；promptDraft 必须写成对编程助手下达的指令（第二人称、可直接复制发送），包含目标、范围边界和验收标准。
3. systemicTags 用 1-4 个简短、规范化的中文标签描述问题类型，便于长期统计，例如「目标模糊」「范围蔓延」「过度设计」「缺少验收标准」「重复读取」「上下文浪费」「报错死循环」「高风险改动」「未验证完成」。同类问题使用同一标签。
4. 禁止名词解释式的空话（例如「grep = 搜索」「token 是计费单位」）；每条结论必须是对本次会话的实质诊断。
5. 禁止建议助手在未经用户同意的情况下自动修改 AGENTS.md、规则文件或创建技能；如确有必要，只能建议用户自行决定。
6. 不要编造节省金额或百分比；骨架里没有的数据不要臆测。`;

export function buildDiagnosisPrompt(
	skeleton: SessionDiagnosticSkeleton,
	lens: DiagnosticLens,
	question?: string,
): string {
	const parts = [SYSTEM_ROLE, LENS_FOCUS[lens]];
	const q = question?.trim();
	if (q) parts.push(`【用户的问题】${q}`);
	parts.push(`【会话骨架】\n${skeleton.dehydratedPromptText}`);
	parts.push(OUTPUT_RULES);
	return parts.join("\n\n");
}

/** Extract the first balanced JSON object from raw model output. */
function extractJsonObject(raw: string): string | null {
	const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidates = fence ? [fence[1], raw] : [raw];
	for (const text of candidates) {
		let start = text.indexOf("{");
		while (start !== -1) {
			let depth = 0;
			let inStr = false;
			let esc = false;
			for (let i = start; i < text.length; i++) {
				const ch = text[i];
				if (inStr) {
					if (esc) esc = false;
					else if (ch === "\\") esc = true;
					else if (ch === '"') inStr = false;
					continue;
				}
				if (ch === '"') inStr = true;
				else if (ch === "{") depth++;
				else if (ch === "}") {
					depth--;
					if (depth === 0) {
						const slice = text.slice(start, i + 1);
						try {
							JSON.parse(slice);
							return slice;
						} catch {
							break;
						}
					}
				}
			}
			start = text.indexOf("{", start + 1);
		}
	}
	return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : [];

export function parseDiagnosis(raw: string, lens: DiagnosticLens): DiagnosticDiagnosisResult {
	const json = extractJsonObject(raw);
	if (!json) throw new Error("诊断模型没有返回有效的 JSON 结果");
	const obj = JSON.parse(json) as Record<string, unknown>;
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
		throw new Error("诊断模型没有返回有效的 JSON 结果");
	}
	const conclusion = str(obj.conclusion);
	if (!conclusion) throw new Error("诊断结果缺少结论（conclusion）");
	const prescriptions: DiagnosticPrescription[] = (Array.isArray(obj.prescriptions) ? obj.prescriptions : [])
		.map((p: unknown) => {
			const r = (p ?? {}) as Record<string, unknown>;
			return { label: str(r.label), promptDraft: str(r.promptDraft), explanation: str(r.explanation) };
		})
		.filter((p) => p.promptDraft)
		.map((p) => ({ ...p, label: p.label || "处方" }))
		.slice(0, 3);
	return {
		lens,
		conclusion,
		evidence: strList(obj.evidence),
		rootCause: str(obj.rootCause),
		prescriptions,
		systemicTags: [...new Set(strList(obj.systemicTags))].slice(0, 4),
		generatedAt: Date.now(),
	};
}

export function buildFollowUpPrompt(
	skeleton: SessionDiagnosticSkeleton,
	result: DiagnosticDiagnosisResult,
	thread: DoctorTurn[],
	question: string,
): string {
	const prior = [
		`结论：${result.conclusion}`,
		result.evidence.length ? `证据：\n- ${result.evidence.join("\n- ")}` : "",
		result.rootCause ? `根因：${result.rootCause}` : "",
		result.prescriptions.length
			? `处方：\n${result.prescriptions.map((p, i) => `${i + 1}. ${p.label}：${p.promptDraft}`).join("\n")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
	const history = thread
		.map((t) => `${t.role === "user" ? "用户" : "教练"}：${t.text}`)
		.join("\n");
	return [
		SYSTEM_ROLE,
		`【会话骨架】\n${skeleton.dehydratedPromptText}`,
		`【此前的诊断】\n${prior}`,
		history ? `【追问记录】\n${history}` : "",
		`【用户追问】${question.trim()}`,
		`请用中文纯文本直接回答（不要输出 JSON），基于骨架和此前诊断中的事实，具体、可执行；禁止名词解释式空话；如需给出指令，写成可直接发给编程助手的文字；不得建议在未经用户同意时自动修改 AGENTS.md 或创建技能；不要编造数据。`,
	]
		.filter(Boolean)
		.join("\n\n");
}

const SCOPE_LABEL: Record<SystemicIssue["scope"], string> = {
	"cross-project": "跨项目习惯",
	"same-project": "同项目架构",
	"same-model": "同模型短板",
};

export function aggregateSystemicIssues(history: DoctorHistoryEntry[]): SystemicIssue[] {
	const byTag = new Map<string, DoctorHistoryEntry[]>();
	for (const e of history) {
		for (const tag of new Set(e.tags)) {
			const list = byTag.get(tag) ?? [];
			list.push(e);
			byTag.set(tag, list);
		}
	}
	const issues: SystemicIssue[] = [];
	for (const [tag, entries] of byTag) {
		if (entries.length < 2) continue;
		const sessionIds = [...new Set(entries.map((e) => e.sessionId))];
		const byCwd = new Set(entries.map((e) => e.cwd));
		const byModel = new Set(entries.map((e) => e.model));
		// Same tag in one project → project structure; across projects but one
		// model → model weakness; across projects and models → personal habit.
		if (byCwd.size === 1) {
			const cwd = entries[0].cwd;
			issues.push({
				scope: "same-project",
				tag,
				count: entries.length,
				sessionIds,
				scopeLabel: SCOPE_LABEL["same-project"],
				hint: `「${tag}」在项目 ${cwd.split(/[\\/]/).filter(Boolean).pop() || cwd || "未知项目"} 中反复出现 ${entries.length} 次，可能与该项目的结构或约定有关。`,
			});
		} else if (byModel.size === 1) {
			issues.push({
				scope: "same-model",
				tag,
				count: entries.length,
				sessionIds,
				scopeLabel: SCOPE_LABEL["same-model"],
				hint: `「${tag}」在模型 ${entries[0].model || "未知模型"} 的 ${byCwd.size} 个项目会话中共出现 ${entries.length} 次，可能是该模型在此类任务上的短板。`,
			});
		} else {
			issues.push({
				scope: "cross-project",
				tag,
				count: entries.length,
				sessionIds,
				scopeLabel: SCOPE_LABEL["cross-project"],
				hint: `「${tag}」在 ${byCwd.size} 个项目、${byModel.size} 个模型中共出现 ${entries.length} 次，更可能是个人提问习惯，而非某个项目或模型的问题。`,
			});
		}
	}
	return issues.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 3);
}
