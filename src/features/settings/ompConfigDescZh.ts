/**
 * [D] Chinese translations for OMP config descriptions (the long prose shown in
 * the expanded detail view). Keys missing here fall back to the English schema
 * description from ompConfigMeta.ts / the runtime listing.
 */

export const OMP_CONFIG_DESC_ZH: Record<string, string> = {
	"advisor.enabled":
		"启用一个第二模型（分配到 advisor 角色），被动审查每一轮对话并插入建议笔记。",
	"advisor.immuneTurns":
		"顾问的疑虑或阻塞打断主对话后，在这么多主回合内，后续疑虑/阻塞改为非打断式提示。",
	"advisor.maxNotesPerUpdate":
		"顾问每次提示更新最多接受的非阻塞建议数（1–32；界面提供 1–5 快捷选项）。阻塞类提醒不受限制。",
	"advisor.syncBacklog":
		"顾问落后主对话超过该回合数时，主代理最多暂停 30 秒等待追平。关闭则不启用追平等待。",
	"ask.enabled": "启用 ask 工具，允许代理向你提出交互式问题",
	"ask.notify": "ask 工具等待输入时发送通知",
	"ask.timeout": "超过该秒数后自动选择推荐选项（0 表示不超时）",
	"astEdit.enabled": "启用 ast_edit 工具，进行基于 AST 的结构化改写",
	"astGrep.enabled": "启用 ast_grep 工具，进行基于 AST 的结构化搜索",
	"async.enabled": "启用异步 Bash 命令与后台任务执行",
	autoResume: "自动恢复当前目录下最近一次会话",
	autocompleteMaxVisible: "自动补全下拉最多可见条数（3-20）",
	"autolearn.autoContinue":
		"开启后，停止时自动运行一轮私有捕获回合（消耗额外 Token）。关闭则仅保留常驻的自动学习指引。",
	"autolearn.enabled":
		"代理停止后，提示它将经验教训写入记忆，并创建/完善独立的托管技能",
	"bash.allowCompoundCommands":
		"对字面 && 命令链逐段评估；未匹配的段落按常规 Bash 审批策略与模式处理",
	"bash.autoBackground.enabled":
		"长时间运行的 Bash 命令自动转入后台，结果稍后回传",
	"bash.direnv":
		"自动把仓库的 direnv/devenv `.envrc` 加载进 Bash 会话，使 devenv 工具与环境变量无需手动 `direnv exec` 即可用。遵循 direnv 的允许列表：未经 `direnv allow` 的 `.envrc` 永远不会执行",
	"bash.direnvLoadTimeoutMs":
		"首次 `direnv export` 的最长等待（冷启动 devenv 可能较慢）；超时后会话在无 direnv 环境下继续",
	"bash.enabled": "启用 bash 工具以执行 Shell 命令",
	"bash.patterns":
		"有序的 Bash 命令审批规则。每项包含 match 与 approval 字段；仅支持 '*' 通配符",
	"bashInterceptor.enabled": "拦截已有专用工具对应的 Shell 命令",
	"branchSummary.enabled": "离开分支时提示生成摘要",
	"browser.cdpUrl":
		"默认的 HTTP CDP 发现端点（如 http://127.0.0.1:9222），附加到已有浏览器而不是新开。工具调用里显式指定的 app.cdp_url 或 app.path 优先",
	"browser.cmux":
		"检测到 cmux socket 时，使用 cmux WKWebView 界面做浏览器自动化。可设置 PI_BROWSER_CMUX=0 或 1 覆盖",
	"browser.enabled": "启用浏览器 eval 前奏，可脚本化驱动 Chromium（Puppeteer）",
	"browser.freezeOnTurnEnd":
		"回合结束时冻结 OMP 启动的无头浏览器标签页，动画页面不再空转消耗 CPU/GPU。下次使用自动解冻；打开时传 persist:true 可豁免",
	"browser.headless": "以无头模式启动浏览器（关闭则显示浏览器界面）",
	"browser.idleCloseSec":
		"OMP 启动的无头标签页空闲超过该秒数后关闭（0 = 从不；会话销毁时仍会清理）。仅作用于 OMP 启动的无头标签页，不影响中继/CDP/外部浏览器或其他会话的标签页",
	"browser.relay":
		"通过 omp browser relay 驱动你自己的 Chrome 标签页。需安装一次扩展（`omp browser-relay install`）；浏览器前奏需要时中继服务自动启动。优先于浏览器 CDP 地址；可设 PI_BROWSER_RELAY=0 或 1 覆盖",
	"browser.relayUrl": "omp browser relay 端点（默认 http://127.0.0.1:9224）",
	"browser.screenshotDir":
		"截图保存目录。未设置时存到临时文件。支持 ~。示例：~/Downloads、~/Desktop、/sdcard/Download（Android）",
	"checkpoint.enabled": "启用 checkpoint 与 rewind 工具，做上下文检查点与回溯",
	"codexResets.autoRedeem":
		"自动使用已保存的 Codex 限额重置：当回合卡住且没有其他账户可接管时，恢复被 5 小时/每周窗口耗尽的账户，并抢救即将过期的额度。unset = 首次使用前询问，yes = 直接使用，no = 关闭",
	"codexResets.keepCredits":
		"保存的重置额度低于该数量时绝不自动使用（0 = 最后一张也可自动使用）。即将过期的额度不受限制——反正过期就作废",
	"codexResets.minBlockedMinutes":
		"仅当自然解锁时间——5 小时/每周窗口中最近的重置点——至少在这么多分钟之后才自动兑换（不为省一点等待浪费稀缺额度）。调高（如 360）可忽略仅 5 小时窗口的封锁",
	"codexResets.salvageHorizonHours":
		"已存重置将在该小时数内过期、且 5 小时或每周窗口还有值得恢复的用量时，自动使用它（0 = 关闭过期抢救）",
	"collab.autoStart":
		"每个交互会话启动时都通过 collab.relayUrl 托管并发布到本地注册表（omp collab list）；切换会话时房间轮换",
	"collab.displayName": "协作中向其他人显示的名称（默认：系统用户名）",
	"collab.relayUrl": "/collab 使用的 Relay 地址（wss://host[:port]）",
	"collab.webUrl":
		"/collab 链接使用的网页界面；留空则由 collab.relayUrl 推导；显式 http:// 仅限本机",
	colorBlindMode: "diff 新增行用蓝色代替绿色",
	"commands.enableClaudeProject": "从 .claude/commands/ 加载命令",
	"commands.enableClaudeUser": "从 ~/.claude/commands/ 加载命令",
	"commands.enableOpencodeProject": "从 .opencode/commands/ 加载命令",
	"commands.enableOpencodeUser": "从 ~/.config/opencode/commands/ 加载命令",
	"compaction.asyncEnabled":
		"上下文接近压缩阈值时，后台先投机性生成摘要，越过阈值时直接接入现成结果",
	"compaction.dropUseless":
		"工具结果被判定为无信息（无匹配、等待超时）且消费过即剪除（感知提示缓存）",
	"compaction.enabled": "上下文过大时自动压缩",
	"compaction.experimentalContextManagement":
		"跨上下文窗口保留持久笔记与可搜索的原始历史。需重启以更新可用工具",
	"compaction.handoffSaveToDisk": "把生成的交接文档保存为 Markdown 文件，供自动交接流程使用",
	"compaction.idleEnabled": "空闲且 Token 超过阈值时压缩上下文",
	"compaction.idleThresholdTokens": "空闲压缩触发的 Token 数阈值",
	"compaction.idleTimeoutSeconds": "空闲多久后开始压缩",
	"compaction.methodOrder": "自动上下文维护的首选回退顺序；不可用或失败的方式自动跳到下一项",
	"compaction.midTurnEnabled": "在回合内安全的工具循环边界、下一次供应商请求之前检查阈值",
	"compaction.remoteStreamingV2Enabled": "兼容的远程压缩模型使用 Responses 流式压缩",
	"compaction.supersedeReads": "同一文件再次读取时剪除旧读取结果（感知缓存，每回合运行）",
	"compaction.thresholdPercent": "上下文维护的百分比阈值；设为 Default 时沿用旧的预留式行为",
	"compaction.thresholdTokens": "上下文维护的固定 Token 上限；设置后覆盖百分比",
	"completion.notify": "代理完成一个回合时通知",
	"composer.recallClearedDrafts":
		"Ctrl+C 清空的草稿保留在本地 Up/Down 历史中直到退出；关闭只影响之后的清空",
	"composer.shape": "输入编辑器与状态行的视觉布局",
	"composer.tokenRate":
		"在正在工作的行上、紧挨会话标题的位置实时显示生成 tok/s。由流式增量估算，并随每条消息完成按供应商计费输出数校正",
	"computer.display": "合成所有显示器，或选择指定的显示器 id",
	"computer.enabled": "启用可脚本化的桌面控制 eval 前奏（截图、输入、辅助功能）",
	"computer.maxHeight": "合成截图的最大高度（像素）",
	"computer.maxWidth": "合成截图的最大宽度（像素）",
	"contextPromotion.enabled": "上下文溢出时切换到更大上下文的模型，而不是压缩",
	"debug.enabled": "启用 debug 工具，进行基于 DAP 的调试",
	defaultThinkingLevel: "支持思考的模型的推理深度",
	"dev.autoqa":
		"自动上报工具问题（xd://report_issue）。默认开启；首次上报会请求同意，拒绝后将停用直至重新显式开启",
	"dev.autoqaPush.endpoint": "接收自动 QA JSON 报告的完整 URL（默认 https://qa.omp.sh/v1/grievances）",
	"display.cacheMissMarker": "在请求未命中提示缓存的助手回合后显示分隔线",
	"display.collapseCompacted":
		"实时记录中把压缩前的历史折叠进摘要分隔线之后；关闭则保留完整记录并在每个压缩点加分隔线",
	"display.hideToolActivity": "在记录中隐藏模型发起的工具调用与结果",
	"display.pinnedAgents":
		"编辑器上方固定的活跃代理跳转列表（off 隐藏；collapsed 折叠几行带展开；full 全部列出）",
	"display.shimmer": "工作/加载中消息的动画样式",
	"display.showTokenUsage": "在助手消息上显示每回合 Token 用量",
	"display.showTurnTime": "在助手消息的用量行上显示从提示到产出（含工具调用）的总耗时",
	"display.smoothStreaming": "分块到达时平滑呈现助手文本与流式工具输入",
	doubleEscapeAction: "编辑器为空时连按两次 Esc 的行为：打开记录回溯选择器、打开会话树，或不做任何事",
	"edit.autoRepair.enabled":
		"当一次编辑破坏文件的 AST 解析时，让 smol 模型修复损坏区域（重解析校验；失败则退回警告）",
	"edit.blackbox.enabled": "编辑引入 AST 解析失败时，附加完整的修改前后源码",
	"edit.blockAutoGenerated": "阻止编辑看起来是自动生成的文件（protoc、sqlc、swagger 等）",
	"edit.enforceSeenLines": "拒绝以先前读取/搜索从未完整展示过的行为锚点的编辑",
	"edit.fuzzyMatch": "接受高置信度的空白差异模糊匹配",
	"edit.fuzzyThreshold": "接受模糊匹配的相似度阈值（0-1）",
	"edit.mode": "选择编辑工具变体（replace、patch、hashline 或 apply_patch）",
	"edit.recoverInlineEdits": "把模型以纯文本形式输出的编辑载荷转换为编辑工具调用执行",
	"edit.streamingAbort": "补丁预览失败时中止流式编辑工具调用",
	emojiAutocomplete: "根据 `:name:` 短码联想 Emoji，并展开 `:D`、`:-)` 之类的文字表情",
	"error.notify": "代理因出错停止时通知",
	"eval.autoBackground.enabled": "长时间运行的 eval 单元自动转入后台，结果稍后回传",
	"eval.js": "允许 eval 工具把 JavaScript 单元派发到进程内运行时",
	"eval.py": "允许 eval 工具把 Python 单元派发到 IPython 内核",
	"eval.tools.enabled":
		"允许 eval 单元定义工具（Python 的 @tool、JS 的 tool(fn)），供 task、agent() 与 workpool() 子代理调用",
	"eval.workpool.freshAgents": "workpool 的每个条目都生成全新子代理，而不是复用工作者或批处理队列",
	"exa.enabled": "启用 Exa 网页搜索供应商",
	"exa.searchDelayMs": "Exa 网页搜索请求之间的最小间隔（毫秒）；0 表示不节流",
	extendedContext: "在支持的情况下使用更大的上下文窗口；可能产生高级定价。关闭保持默认或标准定价窗口",
	"extensionHandlers.toolCallTimeoutMs":
		"扩展 tool_call 处理器的有效工作超时（正值）；非法值按 30000ms 处理，等待 OMP 自有对话框的时间不计入",
	externalThinking: "私有草稿区，不展示给用户。会禁用支持的 GPT、Claude 与 Gemini 推理",
	"features.unexpectedStopDetection":
		"助手在没有可见消息的情况下停止时自动恢复。Smart 档还会用小模型对纯文本停止进行分类",
	"fetch.enabled": "允许 read 工具抓取并处理 URL",
	"find.enabled": "启用 find 工具：用自然语言搜索文件与行范围，由 judge 模型角色判定",
	followUpMode: "回合结束后如何处理排队的追问消息",
	"generate_image.enabled":
		"启用 generate_image 工具（文生图与图片编辑）。tools.xdev 开启时以 xd:// 设备形式暴露",
	"git.enabled": "在 TUI 中显示 Git 分支、状态与 PR 信息，并监视仓库元数据",
	"github.cache.enabled":
		"把渲染后的 issue/PR 查看输出缓存到 ~/.omp/cache/github-cache.db，重复读取零成本",
	"github.cache.hardTtlSec":
		"超过软 TTL 后返回缓存行并后台刷新；超过硬 TTL 后丢弃（秒；默认 7 天）",
	"github.cache.softTtlSec": "该窗口内直接返回缓存的 issue/PR 查看行（秒；默认 5 分钟）",
	"github.enabled":
		"启用 github 工具（按操作分发：仓库、issue、PR、diff、搜索、checkout、push 与 Actions 监视等流程）",
	"glob.enabled": "启用 glob 工具，按通配符查找文件",
	"goal.continuationModes": "允许活跃目标在回合间自动延续的运行模式",
	"goal.enabled": "启用会话级目标模式与隐藏的 goal 工具",
	"goal.statusInFooter": "在状态栏的目标指示器旁显示 Token 预算",
	"grep.contextAfter": "每条 grep 匹配之后显示的上下文行数",
	"grep.contextBefore": "每条 grep 匹配之前显示的上下文行数",
	"grep.enabled": "启用 grep 工具，做正则内容搜索",
	hideThinkingBlock: "隐藏助手回复中的思考块",
	"hindsight.apiToken": "需要鉴权的 Hindsight 服务使用的 Bearer 令牌",
	"hindsight.apiUrl": "Hindsight 服务地址（云端或自托管）",
	"hindsight.autoRecall": "每个会话的第一回合自动回忆记忆",
	"hindsight.autoRetain": "每 N 回合以及会话边界自动保留记录",
	"hindsight.bankId": "记忆库标识（默认：项目名）",
	"hindsight.mentalModelAutoSeed":
		"会话开始时，创建库中尚不存在的内置心智模型（project-conventions、project-decisions、user-preferences）",
	"hindsight.mentalModelsEnabled":
		"启动时把整理好的反思摘要（心智模型）读入开发者指令。只读取库中已有模型，不写入。配合 hindsight.mentalModelAutoSeed 可自动创建内置种子集",
	"hindsight.retainMode": "full-session = 每会话一个文档（upsert）；last-turn = 分块保留",
	"hindsight.scoping":
		"global = 一个共享库；per-project = 每个工作目录独立库；per-project-tagged = 共享库加项目标签，回忆时全局与项目记忆合并",
	"images.autoResize": "大图自动缩到 2000x2000 以内，提升模型兼容性",
	"images.blockImages": "禁止把图片发送给 LLM 供应商",
	"images.describeForTextModels":
		"图片发给不支持视觉的模型时，保存为 local:// 并注入视觉模型生成的描述，而不是直接丢弃",
	"images.questionTimeoutMs":
		"read 的 ?q= 图片问答背后视觉模型调用的单次超时（毫秒）。供应商卡死时快速失败并报超时错误，而不是一直阻塞到手动中止。0 = 关闭超时",
	"images.urls.backends": "为图片发布到供应商可访问位置时，按序尝试的多个后端",
	"images.urls.bindHost": "Blob 服务绑定主机；隧道用 loopback，直接对外用 0.0.0.0",
	"images.urls.command":
		"命令后端的 argv 模板；{file} 为图片路径，{mime}/{ext} 可选。使用 stdout 输出的最后一个 URL（如 pasta -b -f {file}）",
	"images.urls.enabled":
		"外发图片经配置的后端链发布，向支持 URL 拉取的供应商发送短链接而非内联 base64。所有后端或供应商拉取失败时自动回退内联",
	"images.urls.publicBaseUrl": "Blob 服务器对外可达的基址 URL（ssh 方式必填，直连可选）",
	"images.urls.sshRemotePort": "SSH 反向转发在远端的监听端口，由你的 Web 服务代理",
	"images.urls.sshTarget": "SSH 反向转发的目标 user@host",
	"images.urls.ttlHours":
		"本地托管的图片 URL 的服务窗口，从会话最后一次发送起算；恢复会话会在同一链接上续期。0 = 只要 broker 运行就一直有效",
	includeModelInPrompt: "在系统提示词中标注当前使用的模型标识，让代理知道自己是谁",
	includeWorkspaceTree: "在系统提示词中渲染工作区目录树。警告：文件变动时可能破坏跨会话的提示缓存",
	inlineToolDescriptors:
		"在系统提示词中渲染完整工具描述，并从供应商工具 schema 中剥离顶层/嵌套 description，使描述文本只发送一次。Auto 对 Gemini 模型启用，其他禁用",
	interruptMode: "插话消息打断工具执行的时机",
	"irc.timeoutMs": "hub 发送 await:true 的超时（毫秒）；0 = 不超时",
	"isolation.backend": "子代理隔离与 worktree 克隆使用的后端",
	"launch.enabled": "启用 launch 工具，托管共享的长时间运行项目进程",
	"live.voice": "Codex 实时语音会话使用的音色",
	"loop.conditionTimeoutMs":
		"`/loop --while` / `--until` 条件命令的最长等待，超时视为损坏并停止循环。0 = 无限等待",
	"loop.mode": "/loop 两次迭代之间、重新提交提示词之前的行为",
	"lsp.diagnosticsDeduplicate": "抑制编辑后与已展示重复的 LSP 诊断，只提示新增或变化的",
	"lsp.diagnosticsOnEdit": "编辑代码文件后返回 LSP 诊断",
	"lsp.diagnosticsOnWrite": "写入代码文件后返回 LSP 诊断",
	"lsp.enabled": "启用 lsp 工具，提供代码智能（定义、引用、诊断、重命名）",
	"lsp.formatOnWrite": "写入代码文件后用 LSP 自动格式化",
	"lsp.lazy": "语言服务器在首次使用时启动（lsp 工具或编辑对应类型文件），而不是会话启动时",
	"lsp.shared":
		"同一项目跨多个 omp 实例共享一个语言服务器（经 daemon broker；不可用时回退私有服务器）",
	"magicKeywords.enabled": "启用独立的 ultrathink、orchestrate、workflowz、jevify 关键词的隐藏提示",
	"magicKeywords.jevify": "让独立的 jevify 附加隐藏的批量判定分类提示",
	"magicKeywords.orchestrate": "让独立的 orchestrate 附加隐藏的多代理编排提示",
	"magicKeywords.ultrathink": "让独立的 ultrathink 请求最大自动思考并附加隐藏提示",
	"magicKeywords.workflow": "让独立的 workflowz 附加隐藏的 eval 工作流提示",
	"marketplace.autoUpdate": "启动时检查插件更新",
	"mcp.enableProjectConfig": "从项目根目录加载 .mcp.json / mcp.json",
	"mcp.notificationDebounceMs": "MCP 资源更新注入会话前的防抖窗口（毫秒）",
	"mcp.notifications": "把 MCP 资源更新注入代理会话",
	"mcp.renderMarkdownResults": "非 JSON 的 MCP 文本结果在记录中以 Markdown 渲染",
	"memory.backend": "关闭、本地摘要管线、Mnemopi SQLite、Hindsight 远程记忆或 Sharpshooter",
	minP: "最小概率阈值（0-1，-1 = 供应商默认）",
	"mnemopi.autoRecall": "每个会话的第一回合把本地记忆注入上下文",
	"mnemopi.autoRetain": "把完成的对话回合保留进本地 Mnemopi 记忆",
	"mnemopi.bank": "可选的共享记忆库基础名。按项目模式会基于它派生项目级库",
	"mnemopi.dbPath": "可选的 SQLite 数据库路径。默认在 agent 记忆目录下",
	"mnemopi.embeddingApiKey": "传给 Mnemopi 的可选向量嵌入 API 密钥",
	"mnemopi.embeddingApiUrl": "传给 Mnemopi 的可选 OpenAI 兼容向量嵌入端点",
	"mnemopi.embeddingModel": "高级：显式指定嵌入模型 id，覆盖变体。留空使用 mnemopi.embeddingVariant",
	"mnemopi.embeddingVariant":
		"本地嵌入模型族。en = 更强的英文模型；multilingual = 跨语言模型。更改后下次启动会重建已有记忆的嵌入",
	"mnemopi.enhancedRecall": "为重复及相似回忆查询启用分级查询结果缓存",
	"mnemopi.llmApiKey": "Mnemopi 远程模式可选的 LLM API 密钥",
	"mnemopi.llmBaseUrl": "Mnemopi 远程模式可选的 OpenAI 兼容 LLM 端点",
	"mnemopi.llmMode": "不使用 LLM、使用在线轻量模型（/models 的 TINY 角色，否则 @smol），或远程 OpenAI 兼容端点",
	"mnemopi.llmModel": "Mnemopi 远程模式可选的 LLM 模型名",
	"mnemopi.noEmbeddings": "强制使用确定性的纯 FTS 检索，不用向量嵌入",
	"mnemopi.polyphonicRecall": "启用四路回忆（向量、图、事实、时间），以倒数排名融合合并",
	"mnemopi.proactiveLinking": "新记忆入库时即纳入情景图，并关联到相关实体与记忆",
	"mnemopi.scoping":
		"global = 一个共享库；per-project = 每个工作目录独立库；per-project-tagged = 项目本地写入 + 全局回忆可见",
	"model.loopGuard.checkAssistantContent": "除思考日志外，对助手正文消息也应用循环守卫",
	"model.loopGuard.enabled": "启用模型推理与正文的自动流式循环检测",
	"model.loopGuard.toolCallReminder":
		"Gemini 推理流连续输出大量规划头却不调用工具时，打断并注入发起工具调用的提醒（需开启循环守卫）",
	"model.toolCallLoopGuard.enabled": "检测跨回合连续相同的工具调用，并注入纠正性插话",
	"model.toolCallLoopGuard.exemptTools": "允许连续重复而不触发跨回合循环守卫的工具名",
	"model.toolCallLoopGuard.threshold": "触发纠正性插话所需的连续相同工具调用次数",
	modelRoleStorage: "模型选择器角色分配的保存位置",
	omitThinking: "指示上游供应商在响应中完全省略思考摘要（在支持的情况下）",
	"paste.largeMenuThreshold":
		"粘贴达到该行数时提供菜单：包成代码块、包进 XML 标签或存为文件。0 = 关闭菜单（大粘贴仍折叠为 [Paste] 标记）",
	personality: "渲染进系统提示词个性区块的沟通风格",
	"plan.autosave": "计划模式完成时把已批准的计划自动保存到磁盘",
	"plan.autosaveDir": "自动保存计划的目录。支持 ~、绝对路径与相对 cwd 路径。留空使用 <project>/.omp/plans/",
	"plan.defaultOnStartup": "每个新会话开始时自动进入计划模式",
	"plan.enabled": "启用计划模式：执行前进行只读探索与规划",
	"power.sleepPrevention": "活跃会话期间阻止系统休眠。各档位逐级叠加——包含所有更低档位的标志",
	presencePenalty: "对已出现 Token 的惩罚（-1 = 供应商默认）",
	"prewalk.enabled":
		"以活跃模型开始，在计划提示的待办清单建立后的首次编辑/写入时切换到快速低价模型（默认 smol 角色）——强模型负责规划、提交待办并开始实现，然后交接。可用 --prewalk / --no-prewalk 按会话覆盖",
	proseOnlyThinking: "思考摘要中省略代码块，以省略号代替",
	"provider.appendOnlyContext":
		"缓存系统提示词与工具定义，并维护只追加的消息日志，使供应商前缀缓存（DeepSeek、小米/SGLang、Anthropic）命中率最大化。Auto 对已知前缀缓存供应商自动启用",
	"providers.anthropic.serverSideFallback":
		"Claude Fable 5 / Mythos 5 请求被 Anthropic 安全分类器拦截时，服务端改用 Claude Opus 4.8 重试（Anthropic `server-side-fallback-2026-06-01` beta）。需主动开启——关闭则所有请求保持回退前的行为",
	"providers.antigravityEndpoint": "google-antigravity 供应商的端点路由策略（chat、search、image、discovery）",
	"providers.autoThinkingMaxEffort":
		"`auto` 分类器可判定的最高力度。`xhigh` 让分类器最高只到次高档，只有显式 `ultrathink` 才到 `max`；`max` 允许分类器判定为例外的回合直接按最高档计费（在模型支持的情况下）",
	"providers.cacheRetention": "转发给支持该功能的供应商（Anthropic、Bedrock、OpenRouter、OpenAI）的提示缓存保留策略",
	"providers.fetch": "fetch/read URL 工具的读取后端优先级",
	"providers.fireworksTier":
		"Fireworks 请求的服务路径。Priority 会在高峰期发送 `service_tier: \"priority\"` 以更高价格换取更高可靠性；Standard 不发送。Fast（-fast）模型忽略此项——Fast 本身就是独立服务路径",
	"providers.kimiApiFormat": "Kimi Code 供应商的 API 格式（auto 跟随线上模型元数据）",
	"providers.maxInFlightRequests":
		"每个供应商 id（如 \"openai\"、\"anthropic\"）的最大并发 LLM 请求数，同一配置根下多个本地 OMP 进程共享。未列出的供应商不受限",
	"providers.ollama-cloud.maxConcurrency": "每进程 Ollama Cloud 子代理并发上限；0 = 关闭该供应商限制",
	"providers.openai-codex.codeMode":
		"把 Codex code_mode_only 模型（GPT-5.6）的路由改为经由 eval。直连工具为 eval、ask、todo、yield、think、checkpoint、rewind，其他会话工具通过 eval 单元使用。对应 codex-rs 的 Code Mode。'auto' 跟随模型目录标记",
	"providers.openai-codex.codeModeDirectTools": "Codex Code Mode 的额外直连工具。标准直连工具为 eval、ask、todo、yield、think、checkpoint、rewind",
	"providers.openaiWebsockets": "OpenAI Codex 模型的 WebSocket 策略（auto 用模型默认，on 强制开启，off 禁用）",
	"providers.openrouterVariant": "附加在 OpenRouter 模型 ID 后的默认路由变体后缀（选择器已含变体时覆盖）",
	"providers.streamFirstEventTimeoutSeconds": "等待模型流首个事件的秒数；-1 用供应商/环境默认，0 关闭看门狗",
	"providers.streamIdleTimeoutSeconds": "模型流事件之间允许的静默秒数；-1 用供应商/环境默认，0 关闭看门狗",
	"providers.tinyModelDevice":
		"本地轻量模型（标题+记忆）的推理后端：某个 ONNX 执行提供器，或 `mlx`（下载 MLX 权重并在 Apple 芯片上经 mlx-lm 运行）。默认用纯 CPU ONNX。环境变量 PI_TINY_DEVICE 可覆盖",
	"providers.tinyModelDtype":
		"本地轻量模型的 ONNX 量化/精度。默认用各模型自带的 dtype（q4）；精度越低越快，越高越保真。MLX 后端忽略此项（其权重已预量化为 4-bit）。环境变量 PI_TINY_DTYPE 可覆盖",
	"providers.webSearchTimeoutSeconds":
		"每个供应商搜索通道的硬超时，超时后 web_search 切换到下一个回退，单位秒（最大 300）",
	"python.interpreter": "精确的 Python 可执行文件路径。设置后跳过自动 Python 运行时发现",
	"python.kernelMode": "IPython 内核在多次 eval 之间保持存活，还是每次全新启动",
	"read.defaultLimit": "代理调用 read 未指定行数时默认返回的行数",
	"read.renderMarkdown": "Markdown 读取结果渲染为格式化终端预览，而不是原始源码",
	"read.summarize.enabled": "read 未显式指定选择器时返回结构化代码摘要",
	"read.summarize.minBodyLines": "多行正文/字面量达到该行数才会被摘要折叠",
	"read.summarize.minCommentLines": "多行块注释达到该长度才会被摘要折叠",
	"read.summarize.minTotalLines": "总行数少于该值的文件原样读取，不做结构化摘要",
	"read.summarize.prose": "对 Markdown 与纯文本读取也返回结构化摘要",
	"read.summarize.unfoldLimit":
		"BFS 展开时摘要大小的硬上限。展开后行数会超限的跨度被跳过（保持折叠），继续展开其余跨度",
	"read.summarize.unfoldUntil": "BFS 展开可省略跨度，直到摘要可见行数达到该值。0 = 只保留最外层省略",
	"read.toolResultPreview": "读取工具结果在记录中内联渲染，而不是摘要行",
	readLineNumbers: "read 工具输出默认附带行号",
	"recap.enabled": "终端空闲一段时间后，生成一段简短的 LLM 现状回顾",
	"recap.idleSeconds": "空闲多少秒后显示回顾",
	repetitionPenalty: "重复 Token 的惩罚（-1 = 供应商默认）",
	"retry.fallbackChains":
		"JSON 对象：把模型角色、模型选择器（\"provider/model-id\"）或供应商通配符（\"provider/*\"）映射到有序回退选择器，例如 {\"default\":[\"openai/gpt-4o-mini\"],\"google-antigravity/*\":[\"google/*\",\"google-vertex/*\"]}。面向模型的键在该模型/供应商活跃时生效（不论角色）；\"provider/*\" 条目保留失败模型的 id、只更换供应商。带 id 前缀的通配符（\"openrouter/google/*\"）会给失败模型的裸 id 重新加前缀（google-antigravity/gemini-x → openrouter/google/gemini-x），作为键时只匹配该前缀下该供应商的 id。回退条目可带显式思考后缀（\"provider/model:low\"、\":high\"、\":max\"、\":off\"）；裸条目继承失败回合的力度，\"provider/*\" 条目始终继承",
	"retry.fallbackRevertPolicy": "回退后何时切回主模型",
	"retry.maxDelayMs":
		"重试之间的最大等待（毫秒）。当供应商要求等待超过该值且没有凭据或模型回退可用时，请求快速失败而非挂起（例如 3 小时的 Anthropic 限流窗口）。0 = 不设上限，让会话在供应商声明的配额重置后自动恢复",
	"retry.maxRetries": "API 出错时的最大重试次数",
	"retry.modelFallback": "允许重试恢复切换到配置的回退模型",
	"retry.usageAwareFallback":
		"利用可靠的 coding-plan 配额报告，优先同供应商账户，其次配置的回退模型，最后才是硬性用量限制。普通配置的 API 密钥不参与",
	"retry.usageReservePct": "coding-plan 模型剩余百分比低于该值即视为接近上限。未知或未映射的用量保持主模型",
	"retry.usageReservePolicy": "所有同供应商 coding-plan 账户都进入预留区间时的处理方式",
	"retry.waitForUsageReset":
		"供应商报告用量耗尽且给出重置时间（任何供应商的 5 小时或每周配额窗口）时，睡到重置而不是在 retry.maxDelayMs 后快速失败。等待可被 Esc 中断，但也会占住子代理——无人值守运行请保持关闭",
	"searxng.endpoint": "用于网页搜索的自托管 SearXNG 实例基址",
	"secrets.enabled": "发送给 AI 供应商前，对配置的密钥做混淆、对凭据形态的 Token 做遮蔽",
	"security.enabled": "启用 OMP 原生的安全扫描规划与执行，以及只读 security:// 资源命名空间",
	"share.redactSecrets": "/share 快照上传前先跑密钥混淆器（使用 secrets.* 配置）",
	"share.serverUrl": "/share 使用的查看/上传基址（加密 blob 上传 + 查看器；链接为 <base>/<id>#<key>）",
	"share.store": "/share 加密会话 blob 的存储位置",
	"sharpshooter.model": "抽取/整理使用的模型选择器，留空 = smol 角色",
	"shellMinimizer.enabled": "在把冗长 Shell 输出（git、npm、cargo 等）交回代理前先压缩",
	"shellMinimizer.sourceOutlineLevel": "cat/read 源码文件的源码大纲模式：default 或 aggressive",
	showHardwareCursor: "显示终端光标以支持输入法",
	skillful: "在系统提示词中列出可用技能；关闭可节省上下文，可按会话用 /skillful 切换",
	"skills.enableSkillCommands": "把技能注册为 /skill:名称 命令",
	"snapcompact.shape": "snapcompact 打印文本使用的边框形态（压缩归档与内联成像）。Auto 按当前模型挑选",
	"snapcompact.systemPrompt":
		"实验性：把选定的系统提示词文本渲染成高密度 PNG 图片并附加到首条用户消息（仅视觉模型）。节省 Token，但被成像的文本失去提示缓存",
	"snapcompact.toolResults":
		"实验性：把较大的历史工具结果渲染成高密度 PNG 图片而非文本（仅视觉模型）。对累积的读取/搜索输出节省 Token",
	"speech.enabled": "助手输出流式生成时同步朗读",
	"speech.enhanced":
		"合成前先用 tiny/smol 模型把助手输出改写成自然口语（描述代码、去掉链接和 Markdown）。失败时回退机械清理",
	"speech.mode": "朗读范围：all = 助手消息+思考；assistant = 仅消息；yield = 仅回合结束的最终消息",
	"speech.voice": "朗读助手输出使用的 Kokoro 音色",
	"speechgen.enabled": "启用 tts 工具，进行端侧（Kokoro）或 xAI Grok Voice 的语音文件合成",
	"spelling.autocomplete": "以行内提示显示 macOS 词典补全，按 Tab 接受",
	"spelling.autocorrect": "词完成后应用有把握的 macOS 拼写纠正",
	"spelling.typoDetection": "用当前 macOS 词典标出提示词中的拼写错误",
	"startup.changelogMode": "更新说明以摘要、完整详情还是隐藏的方式呈现",
	"startup.checkUpdate": "启动时检查 omp 更新",
	"startup.quiet": "跳过欢迎界面与启动状态信息",
	"startup.setupWizard": "每个安装版本只显示一次的新增引导步骤",
	"startup.showSplash": "常规交互启动时显示完整的动画启动画面（不重跑设置）。静默启动仍会抑制它",
	"statusLine.compactThinkingLevel": "思考级别以单个图标显示在模型名旁，而不是单独的 ` · <级别>` 后缀",
	"statusLine.contextLine": "左右两段之间的分隔线如何反映上下文用量（仅框式输入框）",
	"statusLine.preset": "内置的状态栏配置",
	"statusLine.separator": "段与段之间分隔符的样式",
	"statusLine.sessionAccent": "编辑器边框与状态栏间隙使用会话名称的颜色",
	"statusLine.showHookStatus": "在状态栏下方显示 hook 状态信息",
	"statusLine.transparent":
		"状态栏使用终端默认背景而不是主题的 `statusLineBg`。Powerline 端帽会因此去掉——它们需要对比填充才能与终端衔接",
	steeringMode: "代理工作时对排队消息的处理方式",
	"stream.redactPatterns": "在环境/secrets.yml 值与内置凭据形态之外，对每条流式输出额外遮蔽的正则",
	"stream.serverUrl": "`omp stream` 使用的直播服务器（https://host[:port]）；观看地址为 <base>/<你的 Stencil 用户名>",
	"stt.enabled": "启用麦克风语音转文字输入",
	"stt.submitTrigger": "语音听写自动提交时机：从不、松键（2+ 词）、说完完整句子后，或说“提交”时",
	symbolPreset: "图标与符号的字形集（Unicode、Nerd Font 或 ASCII）",
	"task.agentIdleTtlMs":
		"空闲子代理在内存中存活多久后落盘驻留（毫秒）。被驻留的代理在收到消息或恢复时自动复活。0 = 空闲代理一直存活到退出",
	"task.batch":
		"把 task 工具切换为批处理形态：一次调用携带 { context, tasks[] }——每项一个子代理，可按项指定代理（默认会话生成策略代理）、按项隔离，并把必须的共享上下文前置到每个任务。async.enabled=true 时每个生成都是独立后台代理（正常空闲/驻留生命周期）；否则调用阻塞到合并结果。关闭恢复扁平单次生成模式",
	"task.eager": "推动把工作委派给子代理的激进程度",
	"task.enableEffort": "在 task 生成时暴露可选的 effort 参数，允许调用者覆盖每个子代理的思考级别",
	"task.enableLsp":
		"允许 task 工具生成的子代理使用 lsp 工具。默认关闭以保持子代理低成本；当 LSP 感知的委派值得额外 Token 时开启",
	"task.isolation.apply": "隔离任务成功后自动把改动应用到父检出；关闭则保留补丁或分支产物",
	"task.isolation.commits": "嵌套仓库变更的提交信息风格（通用模板或 AI 生成）",
	"task.isolation.enabled": "在检出的隔离副本中运行子代理，之后整合其改动",
	"task.isolation.merge": "隔离任务改动的整合方式（补丁应用或分支合并）",
	"task.maxConcurrency": "并发运行的子代理数量上限",
	"task.maxEffort":
		"task 工具每次生成的 effort 提示允许的最大推理力度。调低可防止调用者把子代理抬高到该上限之上；默认保留模型完整范围",
	"task.maxRecursionDepth": "子代理可以再生成子代理的层数上限",
	"task.maxRuntimeMs":
		"每个子代理的硬墙钟上限（毫秒）。0 = 不限。针对绕过推理层看门狗的供应商侧流挂起的纵深防御；触发时按正常子代理中止并给出“超时”原因",
	"task.prewalk":
		"为内置的通用 `task` 子代理启用 prewalk：以其解析到的模型开始，规划并开始实现，然后在首次编辑/写入时交接给 smol 角色。按代理的覆盖（task.agentPrewalk，在 /agents 中心配置）与用户代理的 `prewalk` frontmatter 不受此开关影响",
	"task.showResolvedModelBadge": "在任务组件状态行显示每个子代理实际使用的模型 ID",
	"task.softRequestBudget":
		"每个子代理的软请求预算（每次运行的助手请求数）。越过即注入收尾插话（见 task.softRequestBudgetNotice）；达到 1.5 倍时强制停止并要求代理交出部分结论。0 = 关闭守卫。内置 scout/sonic 代理有更低的内建上限，低于该上限的值对它们依然生效",
	"task.softRequestBudgetNotice": "子代理越过软请求预算时注入一次收尾插话，在 1.5 倍强制停止前请求它收尾",
	"tasks.todoClearDelay": "已完成或被放弃的待办从待办组件中移除前的延迟",
	temperature: "采样温度（0 = 确定，1 = 发散，-1 = 供应商默认）",
	"terminal.showImages": "在终端中内联渲染图片",
	"terminal.showProgress": "代理或上下文维护运行时发出 OSC 9;4 不确定进度",
	textVerbosity: "OpenAI Responses 与 Codex 响应的详尽度（low、medium 或 high）",
	"theme.dark": "终端为深色背景时使用的主题",
	"theme.light": "终端为浅色背景时使用的主题",
	"tier.advisor":
		"顾问模型的服务层级。None = 标准处理；Inherit = 跟随主代理实时的按厂商层级；选定值则应用到顾问模型所属厂商",
	"tier.anthropic":
		"Claude 请求的处理层级。`priority` 在受支持的直连 Anthropic 模型上实现快速模式（`speed: \"fast\"`）；Bedrock/Vertex Claude 与经 OpenRouter 时忽略",
	"tier.google":
		"Gemini（Google AI Studio + Vertex）请求以及经 OpenRouter 路由的 Google 系模型的处理层级（none = 不发送）。以顶层 `serviceTier` 字段发送",
	"tier.openai":
		"OpenAI / OpenAI-Codex 请求以及经 OpenRouter 路由的 OpenAI 系模型的处理层级（none = 不发送）。以 `service_tier` 发送",
	"tier.subagent":
		"生成的 task/eval 子代理的服务层级。Inherit = 跟随主代理实时的按厂商层级（跟随 /fast）；选定值则应用到子代理模型所属的厂商",
	"title.refreshOnReplan": "待办初始化重新规划后刷新自动生成的会话标题（用户手动设置过的除外）",
	"todo.eager": "首条消息之后推动自动创建待办清单的激进程度",
	"todo.enabled": "启用 todo 工具做任务跟踪",
	"todo.reminders": "停止前提醒代理完成待办",
	"todo.remindersMax": "放弃前最多的待办提醒次数",
	"tools.abortOnFabricatedResult":
		"带内工具调用时，模型在回合中开始幻觉出工具结果就立即停止。关闭则让模型生成完并丢弃伪造的后续内容",
	"tools.approval":
		"按工具的审批策略。'allow' 自动批准，'prompt' 需确认，'deny' 阻止。覆盖在所有审批模式下生效",
	"tools.approvalMode":
		"工具调用的默认审批行为。“每步必问”仅自动批准只读工具；“写操作”自动批准读取与工作区写入；“完全自动”自动批准所有层级（用户策略仍可拦截）",
	"tools.artifactHeadBytes": "输出溢出到产物时与尾部一起内联保留的头部内容量（中间省略）。0 = 关闭（只留尾部）",
	"tools.artifactSpillThreshold": "工具输出超过该大小即存为产物，仅内联保留尾部",
	"tools.artifactTailBytes": "输出溢出到产物时内联保留的尾部内容量",
	"tools.artifactTailLines": "输出溢出到产物时内联保留的尾部行数上限",
	"tools.format":
		"控制工具如何暴露给模型。Auto 优先供应商原生工具调用，所选模型标记为不支持时回退到 GLM 自有方言。Native 强制原生；其余值强制对应的自有方言。会话启动时生效",
	"tools.intentTracing": "要求代理在执行每个工具调用前先描述其意图",
	"tools.maxTimeout": "代理可为任意工具设置的最大超时秒数（0 = 不限）",
	"tools.outputMaxColumns":
		"流式工具输出（bash、python、js eval）与 `read` 的单行字节上限。超宽行省略截断，丢弃到下一换行为止的剩余字节。0 = 关闭",
	"tools.speculativeExecution.enabled":
		"启用可丢弃的首个切片：经校验的本地读取通过直连读取与嵌套 eval 执行。网络请求、供应商补全与真实文件写入不在此基线内",
	"tools.speculativeExecution.maxInFlight": "正常派发之前允许在飞的已校验本地读取数量上限",
	"tools.xdev":
		"把低频（可发现的）工具挂载到 xd:// 设备 URL 下，经 read/write 驱动，而不是每次请求都携带其 schema。显式工具列表授予 read 但不含 write 的会话，通过仅设备写传输挂载（文件系统写入仍被拒绝）。关闭则所有已启用工具顶层平铺",
	"tools.xdevDocs": "选择哪些挂载设备的文档与 schema 内联进系统提示词。Built-ins 保留核心工具内联，MCP 与扩展工具按需",
	"tools.xdevInlineDevices": "xd:// Prompt Docs 为 Built-ins Only 时，名称匹配这些 glob 的动态设备内联（例如 mcp__context_mode_*）。Catalog Only 忽略此项",
	topK: "从 Top-K Token 中采样（-1 = 供应商默认）",
	topP: "核采样截断（0-1，-1 = 供应商默认）",
	treeFilterMode: "打开会话树时的默认过滤模式",
	"tts.localVoice": "本地 TTS 后端（Kokoro）使用的音色（美/英音，女/男声）",
	"ttsr.builtinRules": "加载代理自带的默认规则（可用 ttsr.disabledRules 逐条覆盖）",
	"ttsr.contextMode": "TTSR 触发时对部分输出的处理方式",
	"ttsr.disabledRules": "完全忽略的规则名（对内置默认与你的规则都生效）",
	"ttsr.enabled": "输出匹配规则模式时在流中打断代理（时空流规则）",
	"ttsr.interruptMode": "流中直接打断还是完成后注入警告",
	"ttsr.repeatGap": "同一条规则再次触发前需要间隔的消息数",
	"ttsr.repeatMode": "规则重复方式：每会话一次，或间隔若干消息后可再触发",
	"tui.codexResetFireworks":
		"Codex 每周用量意外重置、新存入重置额度时，在屏幕上三分之一处放一段烟花动画，按 Esc 消失",
	"tui.hyperlinks":
		"把路径与 URL 包装为 OSC 8 超链接，终端原生点击打开（auto：探测支持；off：从不；always：始终）",
	"tui.imeSafeCursor": "把提示词底边框移到独立行，避免 macOS 输入法预编辑挤动它",
	"tui.mouse":
		"在主会话中捕获鼠标点击：点击聚焦活跃子代理卡片与 HUD 行并高亮目标。开启期间，原生文本选择变为 Shift+拖拽，滚轮变为 Shift+滚轮",
	"tui.reactions": "邀请代理用 Emoji 徽章回应你的消息，显示在其气泡上",
	"tui.renderMermaid": "把 Mermaid 代码块渲染为 ASCII 图表",
	"tui.resizeScrollback": "窗口调整稳定后，如何刷新保留在终端回滚区中的记录行",
	"tui.textSizing":
		"用 Kitty 的 OSC 66 文本尺寸协议以 2 倍渲染 Markdown H1 标题。仅在 Kitty 终端生效，其他忽略。默认关闭",
	"tui.tight": "去掉终端输出左右各 1 字符的水平内边距",
	"tui.titleSpinner": "终端标题工作态加载动画的字形集——盲文扫动、月亮填充、单点循环或 ASCII 安全线条",
	"tui.titleState":
		"在终端标题分隔符中显示代理运行状态——工作中为动画加载符（WSL 下为静态 ':'），轮到你时为 '>'，代理等你时为 '!'",
	"tui.vimMode":
		"模态提示词编辑。Esc 离开插入模式；Normal 模式支持 hjkl、0、$、^、w、b、e、gg、G、计数、x/D/C、dd/yy、p、u；操作符可接动作或文本对象（diw、ca(、dap）；v/V 进入可视选择，y 复制、d 删除",
	"tui.vimModeDisplay": "当前 Vim 模式在状态栏的显示方式",
	"update.channel": "`omp update` 与启动更新检查使用的更新通道",
	"vault.enabled":
		"启用 vault:// 内部 URL，经 Obsidian CLI 读写 Obsidian 仓库内容。关闭时 vault:// 解析被拒绝，且系统提示词中省略 vault:// 条目",
	"web_search.enabled": "启用 web_search 工具获取实时网页结果",
	"workspace.additionalDirectories":
		"为每个会话追加的额外工作区目录（多根工作区）。可通过 /add-dir 与 /remove-dir 实时管理。相对路径按 cwd 解析，建议用绝对路径。代理会被告知这些根存在，可对其读取/grep/glob",
	"worktree.base":
		"代理管理的 worktree 基础目录——任务隔离副本、`github` PR 检出与 `omp worktree` 清理都在这里。未设置用 ~/.omp/wt。必须是绝对路径或 ~ 相对路径，相对路径被忽略。环境变量 OMP_WORKTREE_DIR 可覆盖",
	"worktree.cleanSource": "用 `/wt` 创建 worktree 时，把改动搬过去之后重置源检出的跟踪变更并删除未跟踪文件",
	"worktree.clone":
		"`github pr_checkout` 与 Bash 中 `git worktree add` 产生的新 worktree，以当前检出的写时复制克隆起步，让被忽略的构建产物（node_modules、target）直接沿用；文件系统无法克隆时回退普通检出",
};
