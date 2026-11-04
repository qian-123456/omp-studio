# omp-workspace 发版与 Release 规范指南

本文档定义 omp-workspace 项目在 GitHub Releases 上的发版标准、内容规范及发布流程。所有发版者与 CI/CD 自动化流水线必须严格遵循本规范。

---

## 1. GitHub Release 正文强制包含的信息

每次发布新版本时，GitHub Release 的正文（Release Notes）**必须完整包含**以下六大板块信息，严禁使用只有单句简述（如 `See assets to download`）的空白说明：

### 1.1 核心板块清单

| 板块 | 必须性 | 核心内容要求 |
|---|---|---|
| **架构与安装包选型** | **必须** | 明确指引 Apple Silicon（M 系列，`aarch64.dmg`）与 Intel Mac（`x64.dmg`）的对应关系，并说明 `.app.tar.gz` 为自动更新内部使用。 |
| **首次打开安全提示（Gatekeeper 绕过命令）** | **必须（不可缺失）** | 明确告知用户：因开源未购买苹果高昂商业证书，系统会误报“已损坏移入废纸篓”，**软件实际无损坏**。提供一键绕过隔离命令：<br>`xattr -cr /Applications/omp-workspace.app` 以及访达 Control+点击打开的备选步骤。 |
| **运行依赖与环境说明** | **必须** | 说明 `omp` CLI 运行环境依赖（未安装时应用会自动调用官方安装器安装，亦可手动安装），以及需准备模型 API Key 或订阅。 |
| **版本变更日志（Changelog）** | **必须** | 按「新增功能（Features）」、「体验与缺陷修复（Fixes）」、「重大改动（Breaking Changes）」分类列出本次更新亮点。 |
| **校验与文件完整性（Checksums）** | 建议 | 附带发布产物的 SHA256 校验和，便于安全校验。 |
| **技术支持与反馈入口** | **必须** | 提供 GitHub Issues 链接与用户指南链接。 |

---

## 2. 标准 GitHub Release 模板正文（中英双语）

```markdown
## 下载与安装指南 / Installation Guide

| 架构 / Architecture | 适用机型 / Device | 下载文件 / Asset |
|---|---|---|
| **Apple Silicon**（推荐） | M1 / M2 / M3 / M4 / M5 系列芯片 Mac | `omp-workspace_<version>_aarch64.dmg` |
| **Intel** | 老款 Intel 处理器 Mac | `omp-workspace_<version>_x64.dmg` |

> 💡 **说明**：`.app.tar.gz` 与 `.sig` 文件为应用内置自动更新器使用，日常使用请直接下载对应 `.dmg` 安装包。

---

### ⚠️ 重要安全提示：绕过 macOS Gatekeeper 隔离 / macOS Quarantine Bypass

由于开源社区版本尚未购买苹果商业开发者证书，首次在 macOS 上打开可能会弹出拦截提示：
> **“omp-workspace”已损坏，无法打开。你应该将它移到废纸篓。**  
> (*“omp-workspace” is damaged and can’t be opened. You should move it to the Trash.*)

**软件本身没有任何损坏**。这是 macOS 针对未购买商业证书的开源软件实施的隔离保护。只需打开 macOS「终端（Terminal）」，执行以下一行命令即可清除隔离属性并正常开启：

```bash
xattr -cr /Applications/omp-workspace.app
```

**备选免终端方式**：
1. 在「访达 ▸ 应用程序」中，按住 `Control` 键点按 `omp-workspace.app`，在弹出菜单中点击「打开」；
2. 或打开 macOS「系统设置 ▸ 隐私与安全性」，在页面下方找到拦截提示，点击「仍要打开」。

---

### 运行环境要求 / Prerequisites

- **操作系统**：macOS 12.0 及以上版本
- **底层 CLI 引擎**：需要 [`omp`](https://github.com/can1357/oh-my-pi) 命令行工具。若尚未安装，工作台在首次启动时会自动弹出官方安装器静默安装；亦可在终端手动运行 `curl -fsSL https://omp.sh/install | sh`。
- **模型凭据**：准备至少一个模型供应商密钥（支持 API Key、自定义 Base URL 兼容网关或 OAuth 订阅）。

---

### 本次更新内容 / What's New

<!-- 在此处填入具体版本的更新日志 -->
#### 新增功能 / Features
- ...

#### 修复与优化 / Bug Fixes & Improvements
- ...

---

### 问题反馈与帮助 / Support

- 完整使用指南：[在线用户手册](https://github.com/qian-123456/omp-studio/tree/main/docs/guide/zh)
- 提交 Bug 或功能建议：[GitHub Issues](https://github.com/qian-123456/omp-studio/issues)
```

---

## 3. 版本号管理与发版流程

### 3.1 版本号对齐规范
每次发版必须同时更新以下三个文件中的版本号，确保三者完全一致：
1. `package.json` 中的 `"version": "x.y.z"`
2. `src-tauri/tauri.conf.json` 中的 `"version": "x.y.z"`
3. `src-tauri/Cargo.toml` 中的 `version = "x.y.z"`

### 3.2 发版标准步骤
1. 完成代码修改并通过全量测试与构建校验（`pnpm tsc --noEmit`、`pnpm vitest run`、`cargo check`）；
2. 更新上述三个文件的版本号；
3. 提交变更：`git commit -m "chore(release): bump to vx.y.z"`；
4. 打标签：`git tag -a vx.y.z -m "omp-workspace vx.y.z"`；
5. 推送代码与标签：`git push origin main && git push origin vx.y.z`；
6. GitHub Actions (`.github/workflows/release.yml`) 自动开始构建并发布 Release。
