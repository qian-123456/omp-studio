# Monitoring, Diagnostics & Remote Access

> Inspect context watermarks and token expenditure, run session checkups to eliminate inefficiencies, monitor local dev ports, and connect mobile devices securely.

In this chapter, you will learn how to:

- [Analyze token distribution and costs](#token-usage-and-distribution)
- [Run session checkups with Session Doctor](#session-doctor)
- [Diagnose broken and interrupted sessions](#session-diagnostics)
- [Manage local ports and clean orphan processes](#local-services-and-ports)
- [Monitor physical resident memory footprint](#performance-and-memory-monitoring)
- [Configure mobile access across networks](#mobile-remote-access)

## Token Usage and Distribution

Open **Token Heatmap** in the right panel (`⌘J`):
- **Watermark Gauge**: Real-time context consumption as a percentage of the model window.
- **Category Breakdown**:
  - **Tool Calls**: Input parameters and return payloads.
  - **Skills**: Injected skill descriptions.
  - **System Prompt**: Base instructions and AGENTS rules.
  - **MCP Tools**: Schemas registered by external MCP servers.
  - **Reasoning & Reply**: Internal reasoning traces and model outputs.
- **Drilldown**: Click any category to inspect individual calls and click **Locate** to jump directly to the relevant turn.
- **Sub-agent Savings**: Track tokens saved through sub-agent context isolation.

## Session Doctor

When a session becomes sluggish or exhibits repetitive trial-and-error, run **Session Doctor** under **Token Heatmap ▸ 🩺 Session Checkup**:

| Direction | Focus |
| --- | --- |
| **🪙 Cost Saver** | Pinpoint redundant file reads, oversized tool returns, and unnecessary retries |
| **🎯 Prompt Tuning** | Identify vague instructions or missing constraints in initial user prompts |
| **🛡️ Code Pitfalls** | Flag unverified assumptions, over-engineering, or breaking changes |
| **💬 Custom Inquiry** | Ask specific questions regarding session execution |

The Doctor extracts a lightweight skeleton (goals, actions, errors, modified files) and generates an actionable **Correction Prompt Draft**. Click **Fill in composer** to steer the agent immediately.

## Session Diagnostics

For errored or interrupted sessions:
1. Right-click the session in the sidebar and choose **Diagnose this session**.
2. An error summary and diagnostic prompt are generated automatically.
3. Delegate the diagnosis to an idle session or spin up a new diagnostic agent.

## Local Services and Ports

Under the **Services** tab:
- Detect active development servers (Vite, Next.js, Webpack, etc.) with PID and working directory details.
- Identify services spawned by Time Machine snapshots.
- **One-Click Cleanup**: Services whose parent sessions have finished are flagged as **Orphaned**. Click **Clean up all** to terminate them in one click.

## Performance and Memory Monitoring

Click the **Performance xxx MB** button in the bottom status bar:
- Reports physical resident memory (**Footprint**) matching macOS Activity Monitor.
- Separates memory used by the desktop app UI, active agent processes, external OMP instances, and free system memory.
- In dev mode (`pnpm tauri dev`), values are naturally higher due to Vite HMR and debug symbols; production builds are heavily optimized.

## Mobile Remote Access

Configure mobile pairing under **Settings ▸ Mobile access**:

### 1. Local Wi-Fi Pairing
Click **Start**, generate a pairing QR code, and scan it with your phone's camera to open the web workbench. Inspect progress, send prompts, and approve tool calls directly from your phone.

### 2. Cloudflare Tunnel (Remote Cellular Access)
- **Temporary URL**: Automatically provisions an encrypted `trycloudflare.com` tunnel using `cloudflared` (no public IP or router port forwarding required).
- **Custom Domain**: Connect with your custom Cloudflare tunnel and domain for permanent remote access.

### 3. IPv6 Direct Connection & DDNS
Connect directly over IPv6 on cellular networks. Enable **Cloudflare DDNS** to update AAAA DNS records automatically when your dynamic IP changes.

Click **Revoke all** at the bottom of the page to revoke access immediately if a device is lost.
