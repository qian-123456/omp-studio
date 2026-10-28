# 隐私保护与供应商凭据生命周期审计

基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。本目录为只读源码审计与有限模型，不是产品修复或全程序证明。

## 模型与生成

环境：`TLA2TOOLS=$HOME/.cache/statechart/tla2tools.jar`，`JAVA=<JAVA>`。从各模型目录执行 result.json 的 regenerate 命令。工作目录可搬移；重放从仓库根目录运行并设置 `OMP_AUDIT_REPO`，依赖仓库现有 node_modules。

- **PrivacyScope**：73 模型状态，54 图状态，190 图边；见 `scope/out/summary.json`、`scope/out/stories.md`。
- **PrivacyNative**：98 模型状态，35 图状态，119 图边；见 `native/out/summary.json`、`native/out/stories.md`。
- **ProviderKeys**：128 模型状态，68 图状态，291 图边；见 `keys/out/summary.json`、`keys/out/stories.md`。
- **OauthLogin**：323 模型状态，110 图状态，399 图边；见 `oauth/out/summary.json`、`oauth/out/stories.md`。

四张总图较大；建议阅读同目录已打开检查的编号 bug PNG。native/out-status 为限制未发现漂移启动的分析变体，不替代原模型。八份 TLA 的 uncitedConditions 当前全部为 []。Fixed 文件仅为提议；特别是 OAuth 固定模型仍有四个坏图状态，不能宣称完全修复。

## 发现与重放

### 再次选择替换旧历史仍保留旧范围 — `HistoryReplacedWhenAsked`

分类：reproduced consumer behavior。

路径：先仅保护后续内容 → 再选择同时替换旧历史 → 旧消息仍含明文。

Rust store::mark 现有公开测试通过；真实 MarkSecretPopover 与 extension context 重放通过。跨 Rust/extension 的完整原生 IPC 未运行。track=false 分支只重放消费者，未重放 Rust 更新。

源码与证据：`src-tauri/src/privacy/store.rs:170`, `src-tauri/src/privacy/store.rs:204`, `replay/privacy.replay.test.tsx`。

模型提议清除范围并恢复跟踪；不代表产品已修复。

### 哈希相同不证明进程曾加载隐私块 — `CompactionHasNativeCoverage`

分类：trace-and-source-only hypothesis。

路径：启动时隐私块写入失败 → 相同内容重写成功 → 压缩被放行。

真实 extension session_before_compact 的哈希判定已重放；未启动实际 OMP 进程验证原生加载。

源码与证据：`src-tauri/src/privacy/mod.rs:120`, `src-tauri/src/rpc/privacy_ext.rs:39`, `replay/privacy.replay.test.tsx`。

提议使用不可匹配启动标记；仅模型。

### 未填写新密钥时保存模式选择未生效 — `SavedModeMatchesChoice`

分类：trace-and-source-only hypothesis。

路径：编辑加密供应商 → 选择明文但保持密钥为空 → 保存成功但后台保留原模式。

真实 ProviderDialog 重放显示 key=null、mode=plaintext 且成功关闭；未调用 Rust ops 的完整保存入口。

源码与证据：`src/features/providers/ProviderDialog.tsx:301`, `src-tauri/src/providers/ops.rs:367`, `replay/providers.replay.test.tsx`。

提议切换已有密钥存储；仅模型。

### 配置修改成功而凭据清理失败可留下孤立密钥 — `NoOrphanVaultKey`

分类：trace-and-source-only hypothesis。

路径：已有加密密钥 → 写入明文或删除配置 → 凭据清理失败。

未重放实际 KeyStore 故障；模型与写入顺序证据。

源码与证据：`src-tauri/src/providers/ops.rs:185`, `src-tauri/src/providers/ops.rs:476`。

当前提议模型不解决该规则。

### 返回列表后的迟到成功事件不会刷新供应商 — `PanelShowsSavedLogin`

分类：reproduced consumer behavior。

路径：打开登录流程 → 点上一步 → 取消待处理时收到成功 → 供应商未刷新。

真实 OauthLoginDialog 与事件总线边界重放；有效监听控制组刷新一次，返回后监听为零且没有刷新。外部实际凭据保存未运行。

源码与证据：`src/features/providers/OauthLoginDialog.tsx:325`, `replay/providers.replay.test.tsx`。

提议取消完成后刷新；仅部分路径改善，固定模型仍有坏状态。

### 启动未完成就取消可能留下后台登录进程 — `NoOrphanLogin`

分类：trace-and-source-only hypothesis。

路径：开始登录请求在途 → 返回列表 → 后台先处理取消 → 启动后处理。

真实 UI 重放确认启动未 resolve 时会发送 cancel；未验证原生 IPC 调度能否实现模型中的处理反序。

源码与证据：`src-tauri/src/providers/oauth.rs:488`, `src/features/providers/OauthLoginDialog.tsx:352`, `replay/providers.replay.test.tsx`。

等待启动完成的提议阻止最短路径；固定模型未消除全部坏状态。

## 已执行检查

Vitest：2 文件 / 7 测试通过。Rust：1 测试通过 / 754 过滤。测试断言故障可观察行为，属于复现证据，不是预期契约验收。初次测试存在 ResizeObserver 和动态导入查询的测试夹具错误；修正夹具后结果如上。

## 安全边界与遗漏

- 未独立形式化：模型发现并发/替换、密钥批量导入、设置页编辑、mask/reveal、library prompt、剪贴板、fork 继承、提供商 migration。覆盖表中明确标注。
- 真实 OMP secrets.yml 启动加载、原生 IPC 调度、浏览器 OAuth、网络模型发现、系统密钥库与加密实现均是未执行的外部边界。
- 只使用合成字符串；未读取实际凭据、登录、联网或修改产品代码。

## 覆盖表

|路径|状态|说明|
|---|---|---|
|`extension/omp-workspace-privacy.ts`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/privacy/classify.rs`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src-tauri/src/privacy/commands.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/privacy/files.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/privacy/mod.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/privacy/store.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/providers/commands.rs`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src-tauri/src/providers/config_yml.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/key_ref.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/migration.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/mod.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/models_yml_providers.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/models_yml_write.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/oauth.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/providers/omp_config.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/ops.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src-tauri/src/providers/presets.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/rows.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/providers/vault.rs`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src-tauri/src/rpc/privacy_ext.rs`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src/features/chat/privacy/ComposerSecretOverlay.tsx`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/chat/privacy/LibraryPromptCard.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/chat/privacy/MarkSecretPopover.tsx`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src/features/chat/privacy/composerClipboard.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/chat/privacy/composerPrivacy.test.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/chat/privacy/composerPrivacy.ts`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/chat/privacy/useComposerPrivacy.ts`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/privacy/SecretChip.tsx`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/privacy/render.test.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/privacy/render.ts`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/providers/KeyModeRadio.tsx`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src/features/providers/ModelPickerModal.tsx`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/providers/OauthLoginDialog.test.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/OauthLoginDialog.tsx`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src/features/providers/ProviderDialog.tsx`|modeled|有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。|
|`src/features/providers/ProviderGroup.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/ProviderPanel.test.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/ProviderPanel.tsx`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/providers/ProviderRowView.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/SetKeyDialog.tsx`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/providers/contextWindowOnSave.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/envImport.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/envparse.test.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/envparse.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/httpWarning.test.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/httpWarning.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/keyState.ts`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/providers/modelEntry.test.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/modelEntry.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/presets.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/providerGroups.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/providers/store.ts`|read-only|已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。|
|`src/features/settings/sections/PrivacySection.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/settings/sections/ProviderBrandLogo.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/features/settings/sections/ProvidersSection.tsx`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
|`src/stores/privacy.ts`|out-of-model|辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。|
