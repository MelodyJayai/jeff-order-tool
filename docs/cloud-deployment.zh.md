# Jeff 订单工具云端部署说明

目标：让 Jeff 在办公室电脑、家里电脑、手机上访问同一份订单数据，并且都能登录后编辑或核销。

当前建议先走两步：

1. 过渡试运行：天翼云桌面 Windows Server 2025 + Node.js + 固定数据目录。
2. 正式长期运行：云服务器或轻量服务器 + Docker + 域名 + HTTPS + 自动备份。

## 1. 云端版和本地版的区别

本地安装版适合一台电脑做主机，其他设备临时连同一个 Wi-Fi。

云端版适合多设备长期访问同一份数据：

- 数据固定保存在云端 `data` 目录。
- 页面登录后才能查看和操作。
- 手机和电脑都访问同一个 `JEFF_PUBLIC_URL`。
- 网页里不显示 Windows 安装包更新按钮，云端更新由服务器维护。
- 每天保留 SQLite 自动备份。

## 2. 必填配置

复制示例配置：

```powershell
Copy-Item .env.cloud.example .env.cloud
```

打开 `.env.cloud` 后至少确认这些内容：

```text
JEFF_ADMIN_PASSWORD=换成强密码
JEFF_PUBLIC_URL=https://你的域名或Tailscale地址
NEXT_PUBLIC_SITE_URL=https://你的域名或Tailscale地址
JEFF_COOKIE_SECURE=true
JEFF_DEPLOYMENT_MODE=cloud
JEFF_DISABLE_IN_APP_UPDATES=true
```

如果只是天翼云桌面内测，还没有 HTTPS，可以先用：

```text
JEFF_PUBLIC_URL=http://云桌面内网或Tailscale地址:3000
NEXT_PUBLIC_SITE_URL=http://云桌面内网或Tailscale地址:3000
JEFF_COOKIE_SECURE=false
```

只要开放到公网，必须优先上 HTTPS，并使用强密码。

## 3. 从 Jeff 本地 0.1.8 数据迁移到云端

Jeff 当前旧目录是：

```text
D:\tools\JeffOrderTool-v0.1.8
```

如果是默认解压结构，真实数据通常在：

```text
D:\tools\JeffOrderTool-v0.1.8\JeffOrderTool\data
```

先让 Jeff 关闭本地订单工具，然后在云端机器运行：

```powershell
npm run migrate:cloud-data -- --from "D:\tools\JeffOrderTool-v0.1.8\JeffOrderTool\data" --to "D:\JeffOrderToolCloud\data"
```

脚本会做这些保护：

- 自动检查源目录里是否有 `orders.db`。
- 复制整份 `data`，包括密码文件、备份、SQLite WAL/SHM 文件。
- 如果目标目录已有文件，会先生成 `data-before-cloud-migration-时间` 备份。
- 如果目标云端数据库已经有真实订单，默认会停止，避免覆盖。

只有在你确认要覆盖目标云端数据时，才加 `--force`。

## 4. 天翼云桌面 Windows 试运行

在云桌面中安装 Node.js LTS 和 Git 后，进入项目目录：

推荐优先使用一键部署脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\cloud\windows\setup-cloud-desktop.ps1 `
  -AppDir . `
  -DataDir "D:\JeffOrderToolCloud\data" `
  -Port 3000 `
  -PublicUrl "http://你的访问地址:3000" `
  -AdminPassword "换成至少8位的强密码" `
  -OldDataPath "D:\tools\JeffOrderTool-v0.1.8\JeffOrderTool\data"
```

这个脚本会自动完成：

1. 检查 Node.js 和 npm。
2. 创建或更新 `.env.cloud`。
3. 安装依赖并执行生产构建。
4. 在目标云端数据为空时迁移 Jeff 旧 `data` 目录。
5. 注册登录后自动启动任务和每日备份任务。
6. 启动服务并检查 `/api/health`。

如果需要让同一私有网络或公网访问当前端口，可以显式增加 `-OpenFirewall`。这个参数会创建 Windows 防火墙入站规则，只开放当前端口的 Private/Domain 网络配置。

下面是手动部署和排查命令。

```powershell
npm ci
npm run build
```

手动启动云端服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\cloud\windows\run-cloud-server.ps1 -AppDir . -DataDir "D:\JeffOrderToolCloud\data" -Port 3000 -PublicUrl "http://你的访问地址:3000"
```

确认能访问：

```text
http://云桌面地址:3000
```

查看健康检查：

```text
http://云桌面地址:3000/api/health
```

如果要注册开机/登录后自动运行和每日备份任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\cloud\windows\register-cloud-tasks.ps1 -AppDir . -DataDir "D:\JeffOrderToolCloud\data" -Port 3000 -PublicUrl "http://你的访问地址:3000"
```

然后可以立即启动任务：

```powershell
Start-ScheduledTask -TaskName JeffOrderToolCloud
```

日志位置：

```text
D:\JeffOrderToolCloud\data\logs\server.log
D:\JeffOrderToolCloud\data\logs\backup.log
```

## 5. Docker 正式部署

复制配置：

```bash
cp .env.cloud.example .env.cloud
```

编辑 `.env.cloud`，至少配置：

```text
JEFF_ADMIN_PASSWORD=replace-with-a-strong-password
JEFF_PUBLIC_URL=https://orders.example.com
NEXT_PUBLIC_SITE_URL=https://orders.example.com
JEFF_COOKIE_SECURE=true
```

启动：

```bash
docker compose up -d --build
```

数据目录：

```text
./cloud-data
```

备份目录：

```text
./cloud-data/backups
```

查看日志：

```bash
docker compose logs -f
```

手动每日备份：

```bash
docker compose exec jeff-order-tool node scripts/backup-sqlite.cjs
```

## 6. HTTPS 和访问方式

内测阶段推荐：

- Tailscale 或 ZeroTier 私有网络。
- Jeff 手机和两台电脑加入同一个私有网络。
- 不直接把 3000 端口暴露到公网。

正式公网阶段推荐：

- 域名解析到云服务器。
- Caddy 或 Nginx 反向代理到 `127.0.0.1:3000`。
- 开启 HTTPS。
- `.env.cloud` 里设置：

```text
JEFF_PUBLIC_URL=https://orders.example.com
NEXT_PUBLIC_SITE_URL=https://orders.example.com
JEFF_COOKIE_SECURE=true
```

## 7. 备份和恢复

自动备份来自两处：

- 打开首页时，系统会检查当天是否已有每日备份。
- Windows 计划任务或服务器计划任务可以每天运行 `npm run backup:daily`。

恢复时：

1. 停止云端服务。
2. 备份当前 `data` 目录。
3. 用需要恢复的 `.db` 文件替换 `orders.db`。
4. 删除旧的 `orders.db-wal` 和 `orders.db-shm`。
5. 重新启动服务。

## 8. 第一版云端验收

完成后按这些点验收：

- Jeff 手机离开办公室也能访问同一网址。
- Jeff 两台电脑看到的是同一批订单。
- 新增订单后，手机刷新能看到。
- 手机核销后，电脑刷新能看到绿色已核销状态。
- `/health` 页面显示数据库、订单数、备份目录正常。
- 云桌面或服务器重启后，服务能自动恢复。
- `backups` 目录里能看到每日备份文件。
