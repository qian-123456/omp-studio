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

## Add a Photo from Your Phone

1. Connect your phone and computer to the same trusted Wi-Fi network or phone hotspot.
2. In the computer's composer, choose **+ ▸ Phone camera** and scan the QR code. Once connected, the QR code collapses into a status bar beside the composer. Choose **Show QR code** to open it again; collapsing it does not end the connection.
3. Take photos repeatedly or select several from your library. Review and remove photos in the list, then select **Upload pending photos** to upload the batch sequentially (up to 20 photos / 200 MiB per connection). Photos appear in the original draft; nothing reaches the model until you send it yourself.
4. Close the panel or select **End connection** to stop receiving. Already attached photos remain in the draft. When reopened, the previous connection finishes closing before a new QR code is generated. Each connection lasts at most ten minutes.

The phone page prioritizes capture, the photo list and upload. Expand **How it works** for format, capacity and cache details. Disconnection, expiry and storage failures remain directly visible rather than hidden in the disclosure.

Interruption recovery: first choose **Reconnect** in the computer's camera status bar or QR panel. It immediately opens the panel and generates a fresh QR, without waiting for expiry. Then tap **Reconnect** at the top of the phone page and photograph the new computer QR using the system camera picker. Decoding renews the connection in the current page with pending photos retained; pasting a link is not required. This is photograph-to-decode, not a live in-page scanner; the QR photo is never staged or uploaded. After cancelling, use the visible recovery action to photograph again. For a brief outage with valid permission, use the separate retry action; expand the paste fallback only if needed.

In the same browser, with the computer address unchanged and storage available, a newly scanned tab can also restore pending photos without retransmitting confirmed receipts. Moving photos to a different draft requires explicit confirmation and excludes photos already received.

Failed uploads retain their photos and IDs; desktop attachment acknowledgement removes the cache. The port remains stable, with an explicit error if occupied. Storage may fail or be evicted, and the page warns when unavailable. Restarting the app or replacing the capture prevents resuming the old receipt record; a changed computer IP, legacy random-port page or different browser also limits recovery. An open page can still capture and **Save to phone** after disconnection or expiry. Old pages do not acquire the new button automatically: save their photos before opening a fresh QR link from the updated computer app.

This upload-only connection does not require mobile-workbench pairing. Photos travel over **unencrypted** LAN HTTP, so use only trusted networks. Guest networks, client isolation, firewalls, or VPNs may prevent connection; try trusted Wi-Fi or a hotspot. The system camera picker depends on the phone browser; if it does not open, use Safari or Chrome.

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
