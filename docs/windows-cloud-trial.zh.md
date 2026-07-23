# Windows 无公网 IP 云端试用部署

本方案用于在 Windows Server 2025 云桌面上快速验证 Jeff 订单工具的多设备体验。服务器不需要公网 IP，也不开放应用入站端口；应用只监听本机回环地址，由 Cloudflare Quick Tunnel 提供临时 HTTPS 地址。

> 这是试用方案，不是正式生产方案。Quick Tunnel 没有 SLA，地址会在隧道进程重新创建后变化。

## 1. 部署结构

默认安装到 `D:\JeffOrderToolCloudTrial`：

```text
app/                    v0.1.27 独立发布包
config/trial.env        管理员密码，仅 SYSTEM/Administrators 可读
data/orders.db          试用数据库
data/backups/           每日 SQLite 一致性备份
logs/                   应用、隧道和备份日志
scripts/                运维脚本
tools/cloudflared.exe   固定版本且经过 SHA-256 校验的隧道程序
public-url.txt          当前临时公网地址
```

试用隧道默认使用 `HTTP/2`，以兼容会拦截 Cloudflare QUIC/UDP 连接的云桌面网络。确实需要改回自动协商时，可给 `run-trial-tunnel.ps1` 传入 `-Protocol auto`。

云端数据与 Jeff 电脑里的离线数据完全分开，部署和试用不会覆盖离线数据库。

## 2. 一键安装

以管理员身份打开 PowerShell，在仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\cloud\windows\trial\install-trial.ps1
```

安装脚本会：

1. 复制现有 `release-package\JeffOrderTool` 发布包，不依赖系统 Node.js。
2. 下载固定版本的官方 `cloudflared` 并校验 SHA-256。
3. 生成随机管理员密码并收紧配置文件权限。
4. 注册应用、HTTPS 隧道和每日备份三个 `SYSTEM` 计划任务。
5. 验证本机和公网 `/api/health`。
6. 将当前地址和登录信息写入部署目录。

安装目录整体只允许 `SYSTEM` 和本机管理员访问，避免数据库、备份或日志继承云桌面数据盘上过宽的默认权限。

为避免误覆盖，目标目录已经有内容时安装脚本会直接停止。

## 3. 日常查看

当前地址：

```text
D:\JeffOrderToolCloudTrial\public-url.txt
C:\Users\Public\Desktop\Jeff-cloud-trial-address.txt
```

管理员登录信息：

```text
D:\JeffOrderToolCloudTrial\Jeff-cloud-trial-login.txt
```

状态检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\JeffOrderToolCloudTrial\scripts\get-trial-status.ps1
```

状态应满足：

- `LocalHealthy` 和 `PublicHealthy` 都为 `true`。
- 版本号与部署版本一致。
- Server 和 Tunnel 任务为 `Running`。
- DailyBackup 任务每天 `02:30` 运行。

## 4. 保留数据升级程序

先生成新的独立发布包，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\cloud\windows\trial\update-trial.ps1 `
  -PackageDir .\release\JeffOrderTool
```

升级脚本会先生成 SQLite 一致性备份，把新程序复制到暂存目录，短暂停止应用任务并切换程序目录，然后等待新版本 `/api/health` 通过。外部 `data`、`config`、日志、隧道和计划任务不会被覆盖；新程序启动失败时会自动恢复旧程序。旧程序包保留在安装根目录的 `app-retained-*` 目录中。

## 5. 任务与恢复

计划任务名称：

```text
JeffOrderToolCloudTrialServer
JeffOrderToolCloudTrialTunnel
JeffOrderToolCloudTrialDailyBackup
```

应用和隧道使用开机触发、失败重试和无限执行时长。隧道获得新地址后会刷新地址文件，并在地址变化时重启应用，使页面二维码和公开地址保持一致。

不需要创建 Windows 防火墙入站规则。应用固定监听 `127.0.0.1:3210`，外部设备不能绕过 HTTPS 隧道直接连接应用端口。

## 6. 数据与备份

每日备份目录：

```text
D:\JeffOrderToolCloudTrial\data\backups
```

备份脚本使用 SQLite Backup API 生成一致性 `.db` 文件，默认保留 30 天。正式使用前还需要把备份同步到另一台机器或对象存储，避免云桌面磁盘本身损坏时同时丢失数据库和本机备份。

`0.1.24` 起云端提供带预检、差异预览、冲突选择和回滚的迁移工作台。试用期仍建议先使用带 `试用` 标识的测试订单；正式切换时按 `docs/cloud-data-migration.zh.md` 取得最新一致性 `.db` 备份，完成最终合并和抽查，再把云端设为唯一数据源。

## 7. 试用边界

Cloudflare Quick Tunnel 适合这次验证，但存在以下限制：

1. 隧道或服务器重启后地址可能变化，需要重新把最新地址发给 Jeff。
2. 没有固定域名、访问 SLA 和正式服务承诺。
3. 当前只有一个管理员密码，没有多人账号和权限审计。
4. SQLite 适合 Jeff 当前的小团队并发；用户数明显增加后再迁移 PostgreSQL。

试用满意后，优先选择两条正式化路径之一：

1. 保留当前服务器，改用 Cloudflare Named Tunnel 和固定域名，并增加异地备份。
2. 迁移到香港 Linux 云服务器，使用 Docker、固定域名、Caddy HTTPS、云快照和异地备份。
