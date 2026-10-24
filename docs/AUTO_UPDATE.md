# 应用自动更新方案指南 (Tauri 2 + GitHub Release)

本项目（`omp-workspace`）基于 **Tauri 2 官方 Updater 插件 + GitHub Releases** 构建了端到端的安全自动更新体系。

---

## 一、工作原理

1. **非对称加密签名（Minisign / Ed25519）**：
   - 桌面应用客户端内置**公钥** (`plugins.updater.pubkey`)。
   - 每次编译发布时，构建系统使用**私钥**对安装包签名，生成签名文件并把校验散列记录在 `latest.json` 中。
   - 客户端下载更新后会先校验签名，杜绝任何中间人篡改或恶意劫持。

2. **版本分发与清单（GitHub Release）**：
   - 发布端（GitHub Actions）打包并上传 macOS 安装包（`.dmg`、`.tar.gz` 及签名 `.sig`）到 GitHub Releases。
   - 自动在 Release 资源中附带 `latest.json` 清单。
   - 客户端请求官方固定端点：
     `https://github.com/qian-123456/omp-studio/releases/latest/download/latest.json`

3. **客户端就绪体验**：
   - 「设置 ▸ 版本与更新」中展示当前应用版本及更新状态。
   - 支持手动「检查应用更新」、查看更新日志、显示下载进度（百分比）、下载完成后一键「重启应用」应用更新。

---

## 二、密钥配置（已就绪）

本项目的签名密钥对已使用 Tauri CLI 生成：
- **公钥（已配置进代码库）**：
  文件：`src-tauri/tauri.conf.json`
  ```
  dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFEOEJDNUFBRUJBRTNCRkEKUldUNk82N3Jxc1dMcmZtQzRucWpQaHRmY3NEUEthaHRHRitPT2VuazUvVytGbFczS1RqSGRFc2QK
  ```
- **私钥（保存在本机，绝不可提交到 Git 仓库）**：
  路径：`~/.omp-workspace-updater.key`

### 必须完成的 GitHub 仓库配置：
前往 GitHub 仓库设置：`https://github.com/qian-123456/omp-studio/settings/secrets/actions`
添加以下 Repository Secret：
- `TAURI_SIGNING_PRIVATE_KEY`：将 `~/.omp-workspace-updater.key` 文件的完整文本内容复制进去。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：如果生成私钥时未设置密码，留空即可（或设置为 `""`）。

---

## 三、发版操作流程（如何发布新版本）

当你准备发布一个新版本（如 `v0.1.1`）时，只需三步：

### 1. 更新版本号
在以下文件中将版本号改为新版本（例如 `0.1.1`）：
- `package.json` 中的 `"version": "0.1.1"`
- `src-tauri/tauri.conf.json` 中的 `"version": "0.1.1"`
- `src-tauri/Cargo.toml` 中的 `version = "0.1.1"`

### 2. 提交并打 Git Tag
```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore(release): v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

### 3. GitHub Actions 自动构建与发布
推送 `v*` tag 后，GitHub Actions 会自动触发 `.github/workflows/release.yml`：
- 在云端 macOS（Apple Silicon 与 Intel）构建应用安装包；
- 使用私钥完成包签名；
- 自动生成 `latest.json`；
- 在 GitHub 仓库自动创建 Release 并上传安装包和清单。

发布成功后，所有用户的客户端即可检测到更新并直接升级！
