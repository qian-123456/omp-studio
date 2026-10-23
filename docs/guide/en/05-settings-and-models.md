# Settings: Models & Agent Capabilities

> Master the workbench configuration: manage providers and keys, distinguish model roles from custom sub-agents, configure fallback chains, inspect system prompt composition, and connect MCP and plugins.

In this chapter, you will learn how to:

- [Explore the settings information architecture](#settings-information-architecture)
- [Configure model providers and secure keys](#configure-model-providers-and-keys)
- [Understand the distinction: Model Roles vs Custom Sub-agents](#model-roles-vs-custom-sub-agents)
- [Assign models to roles](#assign-models-to-roles)
- [Create and manage custom sub-agents](#create-and-manage-custom-sub-agents)
- [Replace models in bulk and automate quota switching](#bulk-replace-and-quota-templates)
- [Set fallback chains and auto-retries](#fallback-chains-and-retries)
- [Manage rule files, memory, and prompt composition](#rules-memory-and-prompt-composition)
- [Connect MCP servers and plugins](#mcp-servers-and-plugins)
- [Protect secrets with the privacy library](#the-privacy-library)
- [Back up, restore, and update settings](#backup-restore-and-updates)

## Settings Information Architecture

Open settings via the gear icon in the sidebar or by pressing `⌘,` (or `/settings` in the composer).

The settings are structured into seven distinct groups:

| Group | Included Pages & Scope |
| --- | --- |
| **General** (「常规」) | **General** (defaults, Git delivery mode, approvals), **Storage** (disk usage & cleanup), **Appearance** (themes & density), **Notifications** (system alerts), **Privacy** (secret redaction) |
| **Models** (「模型」) | **Models and providers** (API keys, OAuth accounts), **Model roles** (role mappings), **Thinking and sampling** (reasoning effort), **Helper models** (advisors & vision), **Fallback models and retries** (fallback chains), **Context window** (token limits & compaction) |
| **Sessions** (「会话」) | **Sessions** (worktree & sleep timers), **Inbox** (triage rules), **Session checkup** (doctor defaults), **Rule files** (AGENTS.md guidelines), **System prompt composition** (system prompt visualizer & AI pruning) |
| **Agent capabilities** (「Agent 能力」) | **Tools** (tool whitelist), **File access** (read/write & LSP), **Command line** (shell execution), **Sub-agents** (custom sub-agent definitions), **Memory** (long-term memory files), **Skills and commands** (skill directories) |
| **Connections** (「连接」) | **Mobile access** (LAN pairing, Cloudflare Tunnel, IPv6 DDNS), **MCP servers** (external tool protocol), **Plugins** (installed plugins & extensions), **Web search** (search engines) |
| **Advanced** (「高级」) | **Advanced** (omp executable path, terminal bridge extension, backup & reset) |
| **Help** (「帮助」) | **User guide** (this guide, feature walkthroughs & shortcuts), **Version and updates** (version check & engine hot-updates) |

## Configure Model Providers and Keys

Navigate to **Settings ▸ Models and providers**:
- **Add Provider**: Select built-in presets (Anthropic, OpenAI, DeepSeek, Gemini, Moonshot Kimi, OpenRouter, SiliconFlow, Groq, Mistral, xAI, Ollama) or **Custom OpenAI Compatible**.
- **Hardware-backed Encryption**: API keys are encrypted with AES-256-GCM using the macOS Keychain master key and stored in `~/.omp-workspace/env/keys.env`. Plaintext keys exist only in memory during network requests.
- **OAuth Subscriptions**: Sign in via OAuth to track usage percentages, reset cycles, and balance across subscription accounts.

## Model Roles vs Custom Sub-agents

Understanding this distinction is essential:

| Dimension | Model Roles (「模型角色」) | Custom Sub-agents (「子代理」) |
| --- | --- | --- |
| **Core Concept** | Model aliases mapped to task categories | Standalone agents with custom prompts, models, and tools |
| **Location** | **Settings ▸ Model roles** | **Settings ▸ Sub-agents** |
| **Storage** | `~/.omp/agent/config.yml` (`modelRoles.*`) | `~/.omp/agent/agents/<name>.md` |
| **Examples** | `default` (main), `smol` (fast), `slow` (reasoning) | `task` (general sub-task), `scout` (read-only search), custom roles |
| **Invocation** | Referenced via `@role` aliases | Dispatched autonomously or assigned explicitly |

## Assign Models to Roles

Under **Settings ▸ Model roles**, assign models to standard system roles:
- **Default (`default`)**: Main conversation and tool calling.
- **Fast (`smol`)**: High-speed, cost-effective lightweight reasoning.
- **Deep (`slow`)**: Architecture design and complex root-cause analysis.
- **Vision (`vision`)**: Multimodal image and screenshot interpretation.
- Use **Reuse role model** (e.g. `@default`) to keep subordinate roles synchronized with your primary model.

## Create and Manage Custom Sub-agents

Under **Settings ▸ Sub-agents**, manage dispatchable expert sub-agents:
1. Click **Add sub-agent**:
   - **Name**: Alphanumeric identifier (e.g. `security-reviewer`).
   - **Description**: Explains when the primary agent should delegate to this specialist.
   - **Assigned Model**: Dedicated model for this role.
   - **Tool Whitelist**: Restrict available tools (e.g., read-only tools).
   - **System Prompt**: Specific guidelines and output contracts.
2. **"Let AI write it"**: Click the AI assistant button to describe your specialist in plain language and generate a complete sub-agent definition in one click.

## Bulk Replace and Quota Templates

- **Bulk Replace**: Open **Settings ▸ Model roles ▸ Bulk replace** to replace all occurrences of a model across global configs, projects, fallback chains, and schedules, complete with a 4-step wizard, impact preview, hot session migration, and full undo history.
- **Quota Templates**: Save role-to-model presets (e.g., "Performance Mode" vs "Cost-Saver Mode"). Set automated downgrade rules to switch templates when provider quotas exceed a threshold (e.g. 90%).

## Fallback Chains and Retries

Under **Settings ▸ Fallback models and retries**:
- Define prioritized fallback chains (e.g., `Claude 3.5 Sonnet` → `DeepSeek V3` → `GPT-4o`).
- Automatically rotate among multiple accounts under the same provider when quota is exhausted.
- Built-in circuit breakers prevent infinite retry loops.

## Rules, Memory, and Prompt Composition

- **Rule Files (AGENTS.md)**: Manage global (`~/.omp/agent/AGENTS.md`) and project-specific rule files under **Settings ▸ Rule files**.
- **Memory Management**: Inspect and clean cross-session memory under **Settings ▸ Memory**.
- **System Prompt Composition**: Under **Settings ▸ System prompt composition**, view an itemized breakdown of tokens consumed by system instructions, tool definitions, MCP schemas, and rules. Click **Analyze with AI** to trim unnecessary instructions.

## MCP Servers and Plugins

- **MCP Servers (Model Context Protocol)**: Connect external tools via local `stdio` commands, HTTP, or SSE under **Settings ▸ MCP servers**. Scope servers to specific projects to save context.
- **Plugins**: Enable or disable installed plugins and native extensions under **Settings ▸ Plugins**.

## The Privacy Library

Under **Settings ▸ Privacy**, prevent API keys and passwords from leaking to upstream LLMs:
- Text matching items in the privacy library is replaced with opaque placeholders (e.g., `⟦secret_a1b2⟧`) before sending.
- Placeholders are restored to plaintext in memory only when executing local tools.

## Backup, Restore, and Updates

- Export and import all app settings under **Settings ▸ Advanced ▸ Data & backup**.
- Check and install updates for both the desktop app and the OMP core engine under **Settings ▸ Version and updates**.
