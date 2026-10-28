---------------------------- MODULE MobileInfra ----------------------------
\* 电脑端手机服务生命周期：局域网服务、隧道、IPv6 TLS 与 DDNS（mod.rs, commands.rs, tunnel.rs, tls.rs, ddns.rs）。
EXTENDS Naturals

VARIABLES
    server,      \* 局域网 HTTP 服务 SERVER (mod.rs:36): stopped/running
    tunnel,      \* 隧道公网地址 ACTIVE (tunnel.rs:16): none/up
    inflight,    \* 正在等待地址的 tunnel::start 调用数 (tunnel.rs:151-247)
    children,    \* 存活的 cloudflared 子进程数 (tunnel.rs:195 spawn)
    v6,          \* IPv6 TLS 服务 IPV6_SERVER (mod.rs:37): off/on
    certHost,    \* IPv6 服务正在使用的证书主机名 (mod.rs:229 ident): none/A/B
    ddnsHost,    \* 设置里的 DDNS 域名 (mod.rs:228 ddns_hostname): A/B
    ddnsSynced   \* 上次成功同步的域名 last_synced_host (ddns.rs:352): none/A/B

vars == <<server, tunnel, inflight, children, v6, certHost, ddnsHost, ddnsSynced>>

TypeOK ==
    /\ server \in {"stopped", "running"}
    /\ tunnel \in {"none", "up"}
    /\ inflight \in 0..2
    /\ children \in 0..2
    /\ v6 \in {"off", "on"}
    /\ certHost \in {"none", "A", "B"}
    /\ ddnsHost \in {"A", "B"}
    /\ ddnsSynced \in {"none", "A", "B"}

Init ==
    /\ server = "stopped"
    /\ tunnel = "none"
    /\ inflight = 0
    /\ children = 0
    /\ v6 = "off"
    /\ certHost = "none"
    /\ ddnsHost = "A"
    /\ ddnsSynced = "none"

\* 启动局域网服务
StartServer ==
    /\ server = "stopped"                        \* mod.rs:144-146 已运行则直接返回
    /\ server' = "running"                       \* mod.rs:155 SERVER = Some
    /\ UNCHANGED <<tunnel, inflight, children, v6, certHost, ddnsHost, ddnsSynced>>

\* 停止全部手机服务
StopServer ==
    /\ server = "running"                        \* mod.rs:177-183 先停隧道、IPv6，再停主服务
    /\ server' = "stopped"                       \* mod.rs:182-183
    /\ v6' = "off"                               \* mod.rs:178-180
    /\ certHost' = "none"
    /\ IF tunnel = "up"                          \* tunnel.rs:272 只有 ACTIVE 存在时才会发出终止信号；等待中的启动不受影响
          THEN /\ tunnel' = "none" /\ children' = children - 1   \* tunnel.rs:272-276
          ELSE /\ tunnel' = tunnel /\ children' = children
    /\ UNCHANGED <<inflight, ddnsHost, ddnsSynced>>

\* 点开始隧道：先确保局域网服务运行，再启动 cloudflared
TunnelStartBegin ==
    /\ tunnel = "none"                           \* tunnel.rs:157 url() 为空才继续；等待中的启动不会设置 url
    /\ inflight < 2                              \* 模型边界
    /\ children < 2
    /\ server = "running"                        \* commands.rs:49 先调用 super::start，成功后才进入隧道
    /\ inflight' = inflight + 1                  \* tunnel.rs:195 子进程已拉起，地址尚未登记
    /\ children' = children + 1
    /\ UNCHANGED <<server, tunnel, v6, certHost, ddnsHost, ddnsSynced>>

\* 隧道地址就绪，登记 ACTIVE
TunnelReady ==
    /\ inflight > 0                              \* tunnel.rs:228-247 等待地址返回
    /\ inflight' = inflight - 1
    /\ tunnel' = "up"                            \* tunnel.rs:249-253 不检查服务是否已停止，也不检查是否已有 ACTIVE
    /\ UNCHANGED <<server, children, v6, certHost, ddnsHost, ddnsSynced>>

\* 等待超时：终止这次的子进程
TunnelStartTimeout ==
    /\ inflight > 0                              \* tunnel.rs:237
    /\ inflight' = inflight - 1
    /\ children' = children - 1                  \* tunnel.rs:241 start_kill
    /\ UNCHANGED <<server, tunnel, v6, certHost, ddnsHost, ddnsSynced>>

\* 点停止隧道
TunnelStop ==
    /\ tunnel = "up"                             \* tunnel.rs:272 ACTIVE 存在
    /\ tunnel' = "none"
    /\ children' = children - 1                  \* tunnel.rs:274 只终止登记过的那一个子进程
    /\ UNCHANGED <<server, inflight, v6, certHost, ddnsHost, ddnsSynced>>

\* 启动 IPv6 HTTPS 服务
Ipv6Start ==
    /\ v6 = "off"                                \* mod.rs:196 已运行则直接返回，不再检查证书
    /\ server' = "running"                       \* mod.rs:191-193 必要时先启动主服务
    /\ v6' = "on"                                \* mod.rs:236-241
    /\ certHost' = ddnsHost                      \* mod.rs:228-229 此刻的 DDNS 域名决定证书
    /\ UNCHANGED <<tunnel, inflight, children, ddnsHost, ddnsSynced>>

Ipv6Stop ==
    /\ v6 = "on"                                 \* mod.rs:251-256
    /\ v6' = "off"
    /\ certHost' = "none"
    /\ UNCHANGED <<server, tunnel, inflight, children, ddnsHost, ddnsSynced>>

\* 用户在设置里改 DDNS 域名（设置模块外部契约；不会重启 IPv6 服务）
SetDdnsHost ==
    /\ ddnsHost' = IF ddnsHost = "A" THEN "B" ELSE "A"
    /\ UNCHANGED <<server, tunnel, inflight, children, v6, certHost, ddnsSynced>>

\* 后台 DDNS 同步成功
DdnsSync ==
    /\ ddnsSynced /= ddnsHost                    \* ddns.rs:338-340 域名变了就不会跳过
    /\ ddnsSynced' = ddnsHost                    \* ddns.rs:352-366 apply_sync_success
    /\ UNCHANGED <<server, tunnel, inflight, children, v6, certHost, ddnsHost>>

Next ==
    \/ StartServer \/ StopServer \/ TunnelStartBegin \/ TunnelReady \/ TunnelStartTimeout
    \/ TunnelStop \/ Ipv6Start \/ Ipv6Stop \/ SetDdnsHost \/ DdnsSync

Spec == Init /\ [][Next]_vars

\* 规则：局域网服务已停止时，不应还有公网隧道地址指向它。
TunnelNeedsServer == (tunnel = "up") => server = "running"

\* 规则：隧道已停止且没有启动在途时，不应残留 cloudflared 进程。
NoOrphanTunnel == (tunnel = "none" /\ inflight = 0) => children = 0

\* 规则：配对页面显示的 IPv6 域名链接，必须被当前使用的证书覆盖。
LinkCoveredByCert == (v6 = "on" /\ ddnsSynced = ddnsHost) => certHost = ddnsHost
=============================================================================
